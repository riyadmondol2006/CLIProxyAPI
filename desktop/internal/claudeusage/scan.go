package claudeusage

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"sync/atomic"

	log "github.com/sirupsen/logrus"
)

const (
	// maxLineBytes is the longest transcript line that is parsed; longer lines are skipped.
	maxLineBytes = 128 << 20
	// readBufferBytes is the read buffer per file.
	readBufferBytes = 1 << 20
	// chunkBytes is how much of a file is parsed before it is handed to the writer.
	chunkBytes = 32 << 20
	// chunkRecords bounds the records held in memory per chunk.
	chunkRecords = 20_000
)

// fileJob is one transcript file to read in a scan.
type fileJob struct {
	Path     string
	Size     int64
	Mtime    int64
	Offset   int64
	Subagent bool
}

// chunk is a run of consecutive complete lines from one file, in file order.
type chunk struct {
	Path    string
	Records []parsed
	// State is stored with the chunk. Size is -1 until the file's last chunk so an
	// interrupted file is resumed rather than treated as unchanged.
	State fileState
}

// progress is shared with the status endpoint while a scan runs.
type progress struct {
	filesTotal atomic.Int64
	filesDone  atomic.Int64
	bytesTotal atomic.Int64
	bytesDone  atomic.Int64
}

// existingDirs returns the sources that are directories.
func existingDirs(sources []string) []string {
	dirs := make([]string, 0, len(sources))
	for _, source := range sources {
		if info, errStat := os.Stat(source); errStat == nil && info.IsDir() {
			dirs = append(dirs, source)
		}
	}
	return dirs
}

// discover lists the .jsonl transcripts under the sources, and the subagent sidecar
// files (subagents/agent-<id>.meta.json), skipping dot-prefixed entries.
func discover(ctx context.Context, sources []string) (files, metas []string, errList error) {
	for _, root := range existingDirs(sources) {
		errWalk := filepath.WalkDir(root, func(path string, entry fs.DirEntry, errEntry error) error {
			if errCtx := ctx.Err(); errCtx != nil {
				return errCtx
			}
			if errEntry != nil {
				log.WithError(errEntry).Debug("claude usage: skip unreadable entry")
				if entry != nil && entry.IsDir() {
					return fs.SkipDir
				}
				return nil
			}
			if path != root && strings.HasPrefix(entry.Name(), ".") {
				if entry.IsDir() {
					return fs.SkipDir
				}
				return nil
			}
			if !entry.Type().IsRegular() {
				return nil
			}
			name := entry.Name()
			switch {
			case strings.HasSuffix(name, ".jsonl"):
				files = append(files, path)
			case strings.HasPrefix(name, "agent-") && strings.HasSuffix(name, metaSuffix) &&
				filepath.Base(filepath.Dir(path)) == "subagents":
				metas = append(metas, path)
			}
			return nil
		})
		if errWalk != nil {
			return nil, nil, fmt.Errorf("list %s: %w", root, errWalk)
		}
	}
	sort.Strings(files)
	sort.Strings(metas)
	return files, metas, nil
}

const metaSuffix = ".meta.json"

// maxMetaBytes bounds a subagent sidecar file; they are a few hundred bytes.
const maxMetaBytes = 1 << 20

// agentFromMeta reads a subagent sidecar. Background (async) Agent dispatches record no
// agentType in the dispatching session, so the sidecar is the only source of the type.
func agentFromMeta(path string) (dispatch, bool) {
	name := filepath.Base(path)
	agentID := strings.TrimSuffix(strings.TrimPrefix(name, "agent-"), metaSuffix)
	if agentID == "" {
		return dispatch{}, false
	}
	f, errOpen := os.Open(path)
	if errOpen != nil {
		return dispatch{}, false
	}
	defer func() {
		if errClose := f.Close(); errClose != nil {
			log.WithError(errClose).Debug("claude usage: close subagent sidecar")
		}
	}()
	var meta struct {
		AgentType string `json:"agentType"`
	}
	if errDecode := json.NewDecoder(io.LimitReader(f, maxMetaBytes)).Decode(&meta); errDecode != nil || meta.AgentType == "" {
		return dispatch{}, false
	}
	// The layout is <project>/<session id>/subagents/agent-<id>.meta.json.
	sessionID := filepath.Base(filepath.Dir(filepath.Dir(path)))
	return dispatch{AgentID: agentID, AgentType: meta.AgentType, SessionID: sessionID}, true
}

// planJobs decides where to resume each file. Unchanged files are left out.
func planJobs(paths []string, states map[string]fileState) []fileJob {
	jobs := make([]fileJob, 0, len(paths))
	for _, path := range paths {
		info, errStat := os.Stat(path)
		if errStat != nil {
			continue
		}
		job := fileJob{
			Path:     path,
			Size:     info.Size(),
			Mtime:    info.ModTime().UnixNano(),
			Subagent: strings.Contains(filepath.ToSlash(path), "/subagents/"),
		}
		if prev, ok := states[path]; ok {
			switch {
			case job.Size == prev.Size && job.Mtime == prev.Mtime:
				continue
			case job.Size < prev.Size || job.Size < prev.Offset || job.Mtime < prev.Mtime:
				// Truncated or replaced: read it again from the start; upserts dedupe.
				job.Offset = 0
			default:
				job.Offset = prev.Offset
			}
		}
		jobs = append(jobs, job)
	}
	return jobs
}

// readLine reads one line including its trailing newline. It returns the bytes
// consumed, whether the line was complete, and whether it exceeded maxLineBytes (then
// line is nil but the bytes are still consumed). buf is reused for long lines.
func readLine(r *bufio.Reader, buf []byte) (line []byte, consumed int, complete, tooLong bool, rest []byte, err error) {
	buf = buf[:0]
	for {
		part, errRead := r.ReadSlice('\n')
		consumed += len(part)
		if errRead == nil && len(buf) == 0 && !tooLong {
			// Fast path: the whole line is in the read buffer.
			return part, consumed, true, false, buf, nil
		}
		if !tooLong {
			if len(buf)+len(part) > maxLineBytes {
				tooLong = true
				buf = buf[:0]
			} else {
				buf = append(buf, part...)
			}
		}
		switch {
		case errRead == nil:
			if tooLong {
				return nil, consumed, true, true, buf, nil
			}
			return buf, consumed, true, false, buf, nil
		case errors.Is(errRead, bufio.ErrBufferFull):
			continue
		case errors.Is(errRead, io.EOF):
			return nil, consumed, false, tooLong, buf, nil
		default:
			return nil, consumed, false, tooLong, buf, errRead
		}
	}
}

// readFile parses a file from job.Offset up to job.Size and emits chunks in order.
func readFile(ctx context.Context, job fileJob, prog *progress, emit func(chunk) error) error {
	f, errOpen := os.Open(job.Path)
	if errOpen != nil {
		return fmt.Errorf("open %s: %w", job.Path, errOpen)
	}
	defer func() {
		if errClose := f.Close(); errClose != nil {
			log.WithError(errClose).Debug("claude usage: close transcript")
		}
	}()
	if job.Offset > 0 {
		if _, errSeek := f.Seek(job.Offset, io.SeekStart); errSeek != nil {
			return fmt.Errorf("seek %s: %w", job.Path, errSeek)
		}
	}
	// Read only what existed when the scan was planned; anything newer waits for the next scan.
	reader := bufio.NewReaderSize(io.LimitReader(f, job.Size-job.Offset), readBufferBytes)
	offset := job.Offset
	current := chunk{Path: job.Path}
	var chunkRead int64
	var buf []byte
	for {
		if errCtx := ctx.Err(); errCtx != nil {
			return errCtx
		}
		line, consumed, complete, tooLong, rest, errRead := readLine(reader, buf)
		buf = rest
		if !complete {
			// A partial last line (or nothing) is left for the next scan.
			prog.bytesDone.Add(int64(consumed))
			if errRead != nil {
				return fmt.Errorf("read %s: %w", job.Path, errRead)
			}
			break
		}
		offset += int64(consumed)
		chunkRead += int64(consumed)
		prog.bytesDone.Add(int64(consumed))
		if !tooLong {
			if record, ok := parseLine(line, job.Subagent); ok {
				current.Records = append(current.Records, record)
			}
		}
		if chunkRead >= chunkBytes || len(current.Records) >= chunkRecords {
			current.State = fileState{Size: -1, Mtime: job.Mtime, Offset: offset}
			if errEmit := emit(current); errEmit != nil {
				return errEmit
			}
			current = chunk{Path: job.Path}
			chunkRead = 0
		}
	}
	current.State = fileState{Size: job.Size, Mtime: job.Mtime, Offset: offset}
	return emit(current)
}

// scanFiles reads the jobs with parallel parsers and one writer. File errors are
// collected and do not stop the scan; database errors do.
func scanFiles(ctx context.Context, store *dbWriter, jobs []fileJob, prog *progress) []error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	workers := runtime.NumCPU() / 2
	workers = max(1, min(workers, 6))
	jobCh := make(chan fileJob)
	chunkCh := make(chan chunk, workers)

	var mu sync.Mutex
	var errs []error
	addErr := func(err error) {
		mu.Lock()
		errs = append(errs, err)
		mu.Unlock()
	}

	var parsers sync.WaitGroup
	for range workers {
		parsers.Go(func() {
			for job := range jobCh {
				errRead := readFile(ctx, job, prog, func(c chunk) error {
					select {
					case chunkCh <- c:
						return nil
					case <-ctx.Done():
						return ctx.Err()
					}
				})
				if errRead != nil && !errors.Is(errRead, context.Canceled) {
					log.WithError(errRead).Warn("claude usage: could not read a transcript")
					addErr(errRead)
				}
				prog.filesDone.Add(1)
			}
		})
	}
	go func() {
		defer close(jobCh)
		for _, job := range jobs {
			select {
			case jobCh <- job:
			case <-ctx.Done():
				return
			}
		}
	}()
	go func() {
		parsers.Wait()
		close(chunkCh)
	}()

	var writeErr error
	for c := range chunkCh {
		if writeErr != nil {
			continue
		}
		if errWrite := store.write(ctx, c); errWrite != nil {
			writeErr = errWrite
			cancel()
		}
	}
	if writeErr != nil {
		addErr(writeErr)
	}
	if errCtx := ctx.Err(); errCtx != nil && writeErr == nil && len(errs) == 0 {
		addErr(errCtx)
	}
	return errs
}
