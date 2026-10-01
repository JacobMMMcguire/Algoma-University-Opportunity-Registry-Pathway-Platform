# Project 1 Evaluation Submission Templates

These files support evaluation; they do not prescribe the application's framework or architecture.

## `release_submission_template.md`

Complete one per assessed release. The deployment URL, release tag, and commit SHA identify the frozen version being evaluated.

## `evaluation_adapter_r1_template.json`

Complete this for Release 1 so deterministic tests can reach the semantics the release requires even when teams choose different route/API names.

Important fields:
- `directory_endpoint` — backend/API endpoint used to obtain directory results;
- `student_detail_endpoint` / `project_detail_endpoint` — API paths with `{id}` placeholder;
- `student_page_route` / `project_page_route` — direct public routes with `{id}` placeholder;
- `query_parameters` — your parameter names for text, skill, availability, and status;
- `directory_results_path` — blank when the endpoint returns an array directly; otherwise a dot path such as `data.items`;
- `id_field`, `skills_field`, `contributors_field` — field names used in returned public data.

The adapter should describe the frozen deployed release truthfully. It is not an opportunity to create a separate evaluator-only implementation.

Inquiry-context probes are optional in the adapter. When absent, those requirements remain peer/browser-tested rather than receiving a fake automated pass.

## `peer_qa_report_r1_template.json`

This is the short structured QA summary. Detailed defects and discussion remain in GitHub Issues. The report must identify the reviewing team, target team/version, scenario evidence, findings, exploratory summary, and readiness assessment.
