# Quarantined backup — do not import from here

`v10.23/` is a frozen byte-for-byte copy of the app as it stood before the
persona/conversation-realism audit (commit `1646557`, also tagged
`pre-audit-v10.23`). It exists so the pre-audit system can be diffed, re-run
headlessly for before/after evidence, or restored wholesale.

Nothing in the live app may reference this directory: `index.html` loads only
`js/*.js`, and the service-worker cache manifest in `sw.js` lists shipped files
explicitly. The verify suite asserts no shipped file contains the string
`backup/`.
