# dsh-fs-retry

Retry `ctx.fs.writeText` on Windows `ReplaceFileW` failures (Win32 **1175**).

## Why

On Windows, `dsh-fs-local` publishes file writes with `ReplaceFileW`. When the target
is briefly held (indexer, AV, cloud-sync filter), it fails with `Win32 1175` and the
whole tool call dies — even though a retry succeeds.

Measured on one machine (`D:` volume, 8k random chars, 50 rounds per directory):

| operation | failures |
|---|---|
| `ReplaceFileW` on `C:` (3 dirs) | 0 / 40, 0 / 40, 0 / 40 |
| `ReplaceFileW` on `D:` (3 dirs) | 18 / 40, 9 / 40, 20 / 40 |
| `MoveFileEx(MOVEFILE_REPLACE_EXISTING)` on `D:` | 0 / 40 |
| `ReplaceFileW` + up to 5 backoff retries on `D:` | 0 / 50 |

`chkdsk /scan` clean; suspending every user-mode candidate (AV GUI, indexer, backup
agent) did not change the rate. The volume carries `wcifs` and `FileCrypt` filter
instances that the working volume does not — that is the working theory, not a
proven cause.

Upstream fix belongs in `dsh-fs-local`: fall back to `rename` on any Windows replace
failure, not only on `ENOENT`. Until that lands, this plugin retries at the service
boundary.

## Install

Lives in a DSH profile, not in `app.asar` — app updates do not overwrite it.

```bash
# 1. put the package somewhere stable, then
#    add a junction (Windows) or symlink so the profile can resolve it
mklink /J "%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-fs-retry" "D:\tools\dsh-fs-retry"

# 2. register the plugin row
#    append to ~/.dsh/profiles/desktop/cordis.patch.yml:
#      - id: fs-retry
#        name: dsh-fs-retry

# 3. restart DSH
```

## Verify

Startup log should show:

```
[fs-retry] 已装载（原型 ok / 实例 ok，重试 8 次）
```

Then write repeatedly to the affected volume and confirm no `Win32 1175` reaches the
tool call. Each retry logs `第 N 次遇到 1175，退避后重试`.

Run the offline self-test:

```bash
node selftest.mjs
```

Three cases: retries then succeeds · non-1175 is not retried · gives up after 8
attempts (~340 ms of backoff).

## Rollback

Remove the row from `cordis.patch.yml` and delete the junction. Nothing else is touched.

## Behaviour

- Only `writeText` is wrapped; `read`/`edit`/`diff` are untouched.
- Only errors whose message matches `Win32 1175` or `ReplaceFileW` are retried.
- 8 attempts, delay `12 ms × attempt`. Worst case ≈ 340 ms before the original error
  surfaces unchanged.
- Arguments and return value pass through untouched; the error type on final failure
  is the original one.

## License

MIT
