//go:build !unix

package app

import "errors"

// startDetached is only supported on Unix-like systems.
func startDetached(string, ...string) error {
	return errors.New("relaunching is not supported on this system")
}
