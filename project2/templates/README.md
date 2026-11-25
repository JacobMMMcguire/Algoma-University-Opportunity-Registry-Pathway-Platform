# Team Project Submission and QA Templates

These files support evaluation; they do not prescribe the application's framework or architecture.

Download the [submission and QA templates (ZIP)](https://moodle.dilab.ca/pluginfile.php/7672/mod_page/intro/templates.zip) and extract it to edit the files described below.

## `release_submission_template.md`

Complete one per assessed release. The deployment URL, release tag, and commit SHA identify the frozen version being evaluated.

Record your Project Option. Required test accounts follow that option's
**current release requirements**. Project 2 already requires authenticated
student, faculty, and staff/admin testing in Release 1. Do not wait until a
later release to provide access that the current test plan needs. Keep sensitive
access details in the approved private course channel.

The ZIP also includes `project2_r1_submission_evidence.md`, the Project 2
Release 1 setup/evidence checklist. It supplements the common release template.

## `evaluation_adapter_r1_template.json`

This is the initial adapter starting point. Follow your Project Option's current release requirements and adapt the interfaces, routes and roles accordingly. Save the completed file as `evaluation_adapter.json`; do not submit the unchanged placeholders or assume R1 fields describe a later release.

Important fields:
- `directory_endpoint` — backend/API endpoint used to obtain directory results;
- `student_detail_endpoint` / `project_detail_endpoint` — API paths with `{id}` placeholder;
- `student_page_route` / `project_page_route` — direct public routes with `{id}` placeholder;
- `query_parameters` — your parameter names for text, skill, availability, and status;
- `directory_results_path` — blank when the endpoint returns an array directly; otherwise a dot path such as `data.items`;
- `id_field`, `skills_field`, `contributors_field` — field names used in returned public data.

The adapter should describe the frozen deployed release truthfully. It is not an opportunity to create a separate evaluator-only implementation.

Inquiry-context probes are optional in the adapter. When absent, those requirements remain peer/browser-tested rather than receiving a fake automated pass.

## `evaluation_adapter_template.json` — R2, R3, R4 and Final

Use this implementation-neutral starting point for a later release and save it
as `evaluation_adapter.json`. Set `release` to `R2`, `R3`, `R4` or `FINAL` and
identify the assessed deployment. Replace the sample check with mappings for
the current published test scenarios/requirements: entry point, action or
request method, required role, fixture setup and expected result. Add mappings
where needed; use your application's actual routes and interfaces.

This file helps peer, instructor and agent review locate and reproduce the
required behavior. Describing a check does not prove it passes; reviewers
verify the result against the published requirements. It supplies no future
features, hidden endpoint names or extra product requirements. Keep passwords
and tokens out of the file and provide test access through the approved
private course channel.

## Peer QA report templates

Use the template for the release you are reviewing, then save it as
`peer_qa_report.json`. Keep the pre-filled `release` value; replace the team
placeholders and `<sha>` with real evidence. A report labelled R1 is not an R2
report. If the target version is unavailable, state that and explain the blocker.

| Review | Starting file | `release` value | Target version |
|---|---|---|---|
| R1 | `peer_qa_report_r1_template.json` | `R1` | `R1-submission@<sha>` |
| R2 | `peer_qa_report_r2_template.json` | `R2` | `R2-submission@<sha>` |
| R3 | `peer_qa_report_r3_template.json` | `R3` | `R3-submission@<sha>` |
| R4 | `peer_qa_report_r4_template.json` | `R4` | `R4-submission@<sha>` |
| Final | `peer_qa_report_final_template.json` | `FINAL` | `FINAL-submission@<sha>` |

These are metadata templates; each release's actual requirements and test plan
are supplied in its Project Book when that release is published.

Record scenario evidence, findings, exploration, observed passes and readiness.
When GitHub is inaccessible, include the complete finding in `findings` and
Moodle Online text, attach evidence, and finalize with **Submit assignment**.
Reply all in the instructor's QA/development email thread so both teams can
discuss it; Moodle submissions alone are normally private to the submitting
team and instructor. If no paired thread exists, contact the instructor.

Mark dependent scenarios Blocked and continue reachable checks. If nothing
is testable or no pass was observed, say so with evidence. The published rubric
governs; a blocker is not an automatic full-mark award. Follow the
[Team Project Operations Handbook](https://moodle.dilab.ca/mod/page/view.php?id=3817).
