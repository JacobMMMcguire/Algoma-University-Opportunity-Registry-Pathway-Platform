// F-18, F-19 (FINAL_PLAN.md D6): discovery and the staff queues are paged. Without `limit` the
// older lists still return everything, so earlier clients keep working.
const assert = require("node:assert/strict");
const { after, before, describe, test } = require("node:test");
const { buildAllFixtureSql, fixtureEmail, loadLifecycleFixture } = require("../src/fixture");
const { SOURCES } = require("../src/external/sources");
const { runSync } = require("../src/external/sync");
const { createClient, signIn, startTestApp } = require("./helpers");

describe("F-18, F-19: paging", () => {
  let t;
  let visitor;
  let student;
  let staff;

  before(async () => {
    t = await startTestApp({ config: { clockDate: loadLifecycleFixture().evaluation_date } });
    await t.db.exec(buildAllFixtureSql());
    await runSync(t.db, SOURCES["mitacs-demo"], "v1");
    visitor = createClient(t.baseUrl);
    student = (await signIn(t, fixtureEmail("S01"))).client;
    staff = (await signIn(t, fixtureEmail("TEST-STAFF"))).client;
  });
  after(() => t.close());

  test("discovery combines the three lists, sorted by title, with the same records they show", async () => {
    const all = (await student.get("/api/discovery?limit=50")).data;
    const projects = (await student.get("/api/projects")).data.projects;
    const industry = (await student.get("/api/opportunities")).data.opportunities;
    const external = (await student.get("/api/external-opportunities")).data.opportunities;
    assert.equal(all.total, projects.length + industry.length + external.length);
    assert.deepEqual(all.counts, { faculty: projects.length, industry: industry.length, external: external.length });
    const titles = all.items.map((i) => i.record.title.toLowerCase());
    assert.deepEqual(titles, [...titles].sort((a, b) => a.localeCompare(b)));
  });

  test("pages follow on with no gaps or repeats, and the last page has no next", async () => {
    const full = (await visitor.get("/api/discovery?limit=50")).data;
    const seen = [];
    let offset = 0;
    for (let guard = 0; guard < 50 && offset !== null; guard += 1) {
      const page = (await visitor.get(`/api/discovery?limit=2&offset=${offset}`)).data;
      assert.ok(page.items.length <= 2);
      seen.push(...page.items.map((i) => `${i.kind}:${i.record.id}`));
      offset = page.next;
    }
    assert.deepEqual(seen, full.items.map((i) => `${i.kind}:${i.record.id}`));
  });

  test("type and the R1-20 filters narrow discovery; bad values are a readable 400", async () => {
    const external = (await visitor.get("/api/discovery?type=external")).data;
    assert.ok(external.items.every((i) => i.kind === "external"));
    assert.equal((await visitor.get("/api/discovery?type=everything")).status, 400);
    assert.equal((await visitor.get("/api/discovery?area=Not%20an%20area")).status, 400);
    const limited = (await visitor.get("/api/discovery?limit=999")).data;
    assert.ok(limited.limit <= 50);
  });

  test("F-19: staff queues page and search; without limit they return everything as before", async () => {
    const users = (await staff.get("/api/admin/users?limit=5")).data;
    assert.equal(users.users.length, 5);
    assert.ok(users.total > 5 && users.next === 5);
    const search = (await staff.get(`/api/admin/users?limit=20&q=${encodeURIComponent("fixture-f-")}`)).data;
    assert.ok(search.users.length > 0 && search.users.every((u) => u.email.startsWith("fixture-f-")));
    assert.ok(Array.isArray((await staff.get("/api/admin/users")).data), "the old shape without limit");

    const lifecycle = (await staff.get("/api/lifecycle?limit=3")).data;
    assert.equal(lifecycle.items.length, 3);
    assert.ok(lifecycle.total >= 7);
    const found = (await staff.get("/api/lifecycle?limit=20&q=museum")).data;
    assert.deepEqual(found.items.map((i) => i.title), ["Accessible museum guide"]);

    const submissions = (await staff.get("/api/partner-submissions?limit=2")).data;
    assert.equal(submissions.submissions.length, 2);
    assert.ok(submissions.total > 2 && Number.isInteger(submissions.awaitingCount));

    const faculty = (await visitor.get("/api/faculty?limit=1")).data;
    assert.equal(faculty.faculty.length, 1);
    assert.ok(faculty.total >= 2 && faculty.next === 1);
  });
});
