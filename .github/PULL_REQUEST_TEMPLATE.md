<!-- Thank you for contributing. Please fill in what applies and check the boxes.
     Full guide: https://github.com/ckyOL/ReadGraph/blob/main/CONTRIBUTING.md -->

## Summary

What does this PR do and why? One or two sentences.

## Spec reference

Link to the spec this implements (from `docs/specs/` or the linked issue). Required for behavior changes.

## Data flow

For parser / data changes: describe how data flows through the change
(raw export → `SourceParser` → `Book` / `CatalogRecord` / `BorrowCycle` → UI).

## Testing

- [ ] `pnpm build` passes
- [ ] `pnpm test` passes
- [ ] Affected e2e specs pass (`pnpm test:e2e`)
- [ ] New or changed behavior is covered by tests (written first, SDD + TDD)

## Dependency changes

- [ ] No new dependencies
- [ ] New dependencies passed the supply-chain checklist (see `docs/npm-supply-chain-security.md`) and the outcome is recorded here
- [ ] `pnpm-lock.yaml` diff reviewed

## Privacy

- [ ] No real personal data committed — no reader card numbers, IPs, or real names; fixtures are desensitized

## Documentation

- [ ] README and/or README-zh updated as needed
- [ ] Relevant spec in `docs/specs/` updated
- [ ] `THIRD_PARTY_NOTICES.md` regenerated if runtime dependencies changed
