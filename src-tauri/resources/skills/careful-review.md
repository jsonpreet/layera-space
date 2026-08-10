---
name: Careful review
description: Review a change for correctness before calling it done
---

Before reporting a change as complete:

- Re-read the diff you produced, not your memory of it.
- Name the failure case for each change: what input makes it wrong?
- Check the edges you did not test: empty input, one item, the maximum, a
  value that is already in the target state.
- If you touched an error path, confirm the error still reaches the caller.
- State plainly what you did not verify, rather than implying you did.
