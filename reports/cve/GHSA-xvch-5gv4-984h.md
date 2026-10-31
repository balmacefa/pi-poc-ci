# CVE-2021-44906 (GHSA-xvch-5gv4-984h) Report

**Aliases**: CVE-2021-44906
**Severity**: CRITICAL
**Affected Package**: minimist, version 1.2.0 (affected range: >=1.0.0 <1.2.6)
**First Fixed Version**: 1.2.6

**How earlier CVEs were fixed in this repository**:
A previous CVE, CVE-2018-16487, was fixed by updating `lodash` from `4.17.4` to `4.17.11` in `targets/vuln-app/package.json` (commit `4f3aebb588204d3f9546288c57afe9103e2c7a89`). The fix involved a direct dependency version bump. This suggests that similar dependency updates would be the proposed fix for `minimist`.

**Proposed Fix**: Update `minimist` to version `1.2.6` or higher.

**Reference Links**:
*   https://nvd.nist.gov/vuln/detail/CVE-2021-44906
*   https://github.com/minimistjs/minimist/issues/11
*   https://github.com/minimistjs/minimist/pull/24
*   https://snyk.io/vuln/SNYK-JS-MINIMIST-559764
