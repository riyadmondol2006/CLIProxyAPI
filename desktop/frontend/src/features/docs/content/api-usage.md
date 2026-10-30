# API usage

**API usage** shows how many tokens went through this proxy: per provider, per account or
API key credential, per model, and per access key. Use it to see which subscription is doing
the work and how much each friend you share the proxy with is using.

## Where the numbers come from

- The proxy counts the tokens each provider reports for every upstream request, by the
  proxy's local date, and keeps the last 90 days.
- Counting starts once a proxy version with this page is running. Earlier requests aren't
  included.
- **Requests** counts every attempt sent upstream. When the proxy retries a request or moves
  on to another account, each attempt counts on its own, and the failed ones are shown next
  to the total.
- **Total** is the total the provider reports, which can include cached or reasoning tokens,
  so it can be more than input plus output.

## Using the page

- Pick a period: **Today**, **7 days**, **30 days**, or **90 days**.
- Pick what to group by:
  - **Provider**: Claude, Codex, Gemini, OpenAI-compatible endpoints, and so on.
  - **Account**: each signed-in account or API key credential, with its provider.
  - **Model**: each model name, with the providers that served it.
  - **Access key**: each key from **Access keys**, by its name. **Deleted keys** collects keys
    you have removed since, and **Other clients** covers requests that didn't use an access
    key, such as plugin traffic.
- The chart stacks the five largest groups by day and combines the rest as **Other**. Hover
  a day, or focus the chart and use the arrow keys, to see the numbers.
- The table lists every group with its share of all tokens. Click a column header to sort.

## API usage and Claude usage

**Claude usage** (in the desktop app) reads Claude Code's own logs on this computer, whether
or not Claude Code goes through the proxy. **API usage** counts what passes through the
proxy, from every app and every device that uses it. The two can differ.
