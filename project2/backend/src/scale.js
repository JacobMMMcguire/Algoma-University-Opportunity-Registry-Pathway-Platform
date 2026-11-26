// F-17 (FINAL_PLAN.md D7): loads project2/final_fixtures/scale_fixture.json through the same HTTP
// routes people use, then measures discovery at that size (F-18) for the release evidence.
//
// Accounts are created the way every fixture account is (a `users` row with a fixture id and a
// synthetic fixture-<id>@algomau.ca address, as in src/fixture.js); each person then signs in
// through the real sign-in flow, with their code read from the operator console. Everything else
// goes through the routes as that person: staff verify faculty and record departures and
// graduations; faculty choose public display, write profiles, create and publish projects, set
// deadlines, agree to supervise, propose matches and complete runs; partners submit through the
// public form; students write profiles, confirm matches and record their own external status. The
// external records arrive through the ordinary sync (runSync) from a feed built from the fixture.
//
// The fixture gives states, not dates, students on matches or descriptions. Choices (recorded in
// DECISIONS.md): the app runs with its clock at LOAD_CLOCK while loading, open runs get a deadline
// of OPEN_DEADLINE and expired ones EXPIRED_DEADLINE, so at the evaluation date they are open or
// expired as the fixture says; a matched or completed run gets a match with one current student,
// taken in turn; texts are short and say they are scale data.
const fs = require("fs");
const path = require("path");
const { createApp } = require("./app");
const { fixtureEmail, fixtureTerm } = require("./fixture");
const { SOURCES } = require("./external/sources");
const { runSync } = require("./external/sync");

const SCALE_PATH = path.join(__dirname, "..", "..", "final_fixtures", "scale_fixture.json");
const LOAD_CLOCK = "2026-09-01";
const OPEN_DEADLINE = "2026-12-15";
const EXPIRED_DEADLINE = "2026-10-15";
const STAFF_ID = "SCALE-STAFF";
const INQUIRY = { general: "open", "listed-projects-only": "projects_only", "not-accepting": "not_accepting" };
const EXTERNAL_STATUS = { matched: "accepted_by_provider", completed: "completed" };

function loadScaleFixture() {
  return JSON.parse(fs.readFileSync(SCALE_PATH, "utf8"));
}

// A small cookie-keeping client, like a browser tab.
function client(baseUrl, headers = {}) {
  let cookie = "";
  async function request(method, url, body) {
    const res = await fetch(`${baseUrl}${url}`, {
      method,
      headers: { ...headers, ...(body !== undefined && { "Content-Type": "application/json" }), ...(cookie && { Cookie: cookie }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const text = await res.text();
    return { status: res.status, data: text ? JSON.parse(text) : null, bytes: Buffer.byteLength(text) };
  }
  return {
    get: (url) => request("GET", url),
    post: (url, body) => request("POST", url, body),
    put: (url, body) => request("PUT", url, body),
  };
}

async function expect(promise, ok, what) {
  const res = await promise;
  if (!ok.includes(res.status)) throw new Error(`${what}: ${res.status} ${JSON.stringify(res.data).slice(0, 300)}`);
  return res;
}

// Loads the scale fixture into `db` (an object from src/db.js) and returns evidence. `config` is
// the app configuration; test mode and an operator secret are switched on for the load only.
async function loadScale(db, config, { evaluationDate = "2026-11-06", log = () => {} } = {}) {
  const fixture = loadScaleFixture();
  const operatorSecret = `scale-load-${Date.now()}-${Math.random().toString(36).slice(2)}-secret`;
  const app = createApp({ db, config: { ...config, testMode: true, operatorSecret, clockDate: LOAD_CLOCK } });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const started = Date.now();
  try {
    // Accounts, as every fixture account is made. The scale staff account is the one made staff
    // directly, like the first staff account on the live site.
    const people = [
      ...fixture.faculty.map((f) => f.fixture_id),
      ...fixture.students.map((s) => s.fixture_id),
      STAFF_ID,
    ];
    for (const id of people) {
      await db.query(
        `INSERT INTO users (email, fixture_id) VALUES ($1, $2)
         ON CONFLICT (email) DO UPDATE SET fixture_id = EXCLUDED.fixture_id`,
        [fixtureEmail(id), id],
      );
    }
    await db.query("UPDATE users SET is_staff = true WHERE fixture_id = $1", [STAFF_ID]);

    const operator = client(baseUrl, { "X-Operator-Secret": operatorSecret });
    async function signIn(id) {
      const c = client(baseUrl);
      const email = fixtureEmail(id);
      await expect(c.post("/api/auth/request-challenge", { email }), [201], `sign-in code for ${id}`);
      const pending = await expect(operator.get("/api/auth/pending-challenges"), [200], "operator console");
      const list = pending.data.challenges || pending.data;
      const code = list.find((p) => p.email === email)?.code;
      if (!code) throw new Error(`no pending code for ${id}`);
      const verified = await expect(c.post("/api/auth/verify", { email, code }), [200], `verify ${id}`);
      c.user = verified.data.user;
      return c;
    }

    log("signing in staff, faculty and students");
    const staff = await signIn(STAFF_ID);
    const faculty = {};
    for (const f of fixture.faculty) {
      faculty[f.fixture_id] = await signIn(f.fixture_id);
      if (f.verified_faculty) {
        await expect(staff.post(`/api/admin/users/${faculty[f.fixture_id].user.id}/verify-faculty`), [200], `verify ${f.fixture_id}`);
      }
    }
    const students = {};
    for (const s of fixture.students) students[s.fixture_id] = await signIn(s.fixture_id);

    log("faculty profiles and public-display choices");
    for (const f of fixture.faculty) {
      const c = faculty[f.fixture_id];
      await expect(c.put("/api/account/public-profile", { allowPublicProfile: Boolean(f.public_profile) }), [200], `choice ${f.fixture_id}`);
      await expect(
        c.put("/api/faculty/me/profile", {
          displayName: f.display_name,
          description: `${f.display_name} (scale fixture).`,
          researchAreas: f.areas,
          inquiryPreference: INQUIRY[f.inquiry_preference],
          externalLinks: [],
        }),
        [200],
        `profile ${f.fixture_id}`,
      );
    }
    for (const s of fixture.students) {
      await expect(
        students[s.fixture_id].put("/api/account/student-profile", { displayName: s.display_name, allowPublicProfile: false }),
        [200],
        `student profile ${s.fixture_id}`,
      );
    }

    log("opportunities");
    const current = fixture.students.filter((s) => s.status === "current").map((s) => s.fixture_id);
    let nextStudent = 0;
    const takeStudent = () => current[nextStudent++ % current.length];
    const feed = [];
    const externalPlans = [];
    const created = [];
    for (const o of fixture.opportunities) {
      const owner = faculty[o.owner];
      if (!owner) throw new Error(`${o.fixture_id}: unknown owner ${o.owner}`);
      const term = fixtureTerm(o.term, o.fixture_id);
      const deadline = o.state === "expired" ? EXPIRED_DEADLINE : OPEN_DEADLINE;
      if (o.source === "external") {
        feed.push({
          external_id: o.fixture_id,
          title: o.title,
          description: `${o.title} (scale fixture).`,
          areas: o.areas,
          authoritative_url: `https://mitacs.example/scale/${o.fixture_id}`,
          closes: o.state === "expired" ? EXPIRED_DEADLINE : OPEN_DEADLINE,
        });
        externalPlans.push(o);
        continue;
      }
      let kind;
      let id;
      if (o.source === "faculty") {
        kind = "project";
        const res = await expect(
          owner.post("/api/projects", { title: o.title, description: `${o.title} (scale fixture).`, researchAreas: o.areas, targetTerm: term, deadline }),
          [201],
          `project ${o.fixture_id}`,
        );
        id = res.data.project.id;
        await expect(owner.post(`/api/projects/${id}/publish`), [200], `publish ${o.fixture_id}`);
      } else if (o.source === "industry") {
        kind = "industry";
        const res = await expect(
          client(baseUrl).post("/api/partner-submissions", {
            organisation: `Scale partner ${o.fixture_id}`,
            contactName: "Scale Contact",
            contactEmail: `${o.fixture_id.toLowerCase()}@scale-partner.example`,
            title: o.title,
            description: `${o.title} (scale fixture).`,
            researchAreas: o.areas,
            capacity: "not-sure",
          }),
          [201],
          `submission ${o.fixture_id}`,
        );
        id = res.data.submission.id;
        await expect(owner.put(`/api/partner-submissions/${id}/willingness`), [200], `willing ${o.fixture_id}`);
        await expect(owner.put(`/api/lifecycle/industry/${id}/schedule`, { targetTerm: term, deadline }), [200], `schedule ${o.fixture_id}`);
      } else {
        throw new Error(`${o.fixture_id}: unknown source ${o.source}`);
      }
      if (o.state === "matched" || o.state === "completed") {
        const student = takeStudent();
        const match = await expect(
          owner.post("/api/matches", { kind, opportunityId: id, students: [fixtureEmail(student)] }),
          [201],
          `match ${o.fixture_id}`,
        );
        await expect(students[student].post(`/api/matches/${match.data.match.id}/confirm`), [200], `confirm ${o.fixture_id}`);
        if (o.state === "completed") {
          await expect(owner.post(`/api/lifecycle/${kind}/${id}/state`, { action: "complete" }), [200], `complete ${o.fixture_id}`);
        }
      }
      created.push({ fixtureId: o.fixture_id, kind, id, state: o.state, owner: o.owner });
    }

    log("external opportunities, through the ordinary sync");
    const source = {
      ...SOURCES["mitacs-demo"],
      id: "scale-demo",
      name: "Scale fixture feed (Mitacs format)",
      fetchFeed: async () => ({ source_id: "scale-demo", records: feed }),
    };
    const sync = await runSync(db, source, "scale", { triggeredBy: staff.user.id });
    const externalIds = Object.fromEntries(
      (await db.query("SELECT id, external_id FROM external_opportunities WHERE source_id = 'scale-demo'")).rows.map((r) => [r.external_id, r.id]),
    );
    for (const o of externalPlans) {
      const id = externalIds[o.fixture_id];
      await expect(faculty[o.owner].put(`/api/external-opportunities/${id}/interest`, { note: "" }), [200], `support ${o.fixture_id}`);
      if (EXTERNAL_STATUS[o.state]) {
        await expect(
          students[takeStudent()].put(`/api/external-opportunities/${id}/my-status`, { status: EXTERNAL_STATUS[o.state] }),
          [200],
          `student status ${o.fixture_id}`,
        );
      }
      created.push({ fixtureId: o.fixture_id, kind: "external", id, state: o.state, owner: o.owner });
    }

    log("departures and graduations");
    for (const f of fixture.faculty.filter((x) => x.active === false)) {
      await expect(staff.post(`/api/admin/users/${faculty[f.fixture_id].user.id}/departure`, { departure: "left" }), [200], `left ${f.fixture_id}`);
    }
    for (const s of fixture.students.filter((x) => x.status === "alumni")) {
      await expect(staff.post(`/api/admin/users/${students[s.fixture_id].user.id}/departure`, { departure: "graduated" }), [200], `graduated ${s.fixture_id}`);
    }

    return { fixture, created, sync, loadSeconds: (Date.now() - started) / 1000, evaluationDate };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// F-18 evidence: what a visitor and a signed-in student get from discovery at this size, against
// a fresh app at the evaluation date.
async function measureDiscovery(db, config, evaluationDate) {
  const app = createApp({ db, config: { ...config, clockDate: evaluationDate } });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const visitor = client(baseUrl);
    const time = async (fn) => {
      const t0 = process.hrtime.bigint();
      const res = await fn();
      return { res, ms: Number(process.hrtime.bigint() - t0) / 1e6 };
    };
    const first = await time(() => visitor.get("/api/discovery"));
    const allProjects = await time(() => visitor.get("/api/projects"));
    const allIndustry = await time(() => visitor.get("/api/opportunities"));
    const allExternal = await time(() => visitor.get("/api/external-opportunities"));
    const faculty = await time(() => visitor.get("/api/faculty?limit=20"));
    return {
      discoveryFirstPage: { items: first.res.data.items.length, total: first.res.data.total, bytes: first.res.bytes, ms: first.ms },
      unpagedLists: {
        items: allProjects.res.data.projects.length + allIndustry.res.data.opportunities.length + allExternal.res.data.opportunities.length,
        bytes: allProjects.res.bytes + allIndustry.res.bytes + allExternal.res.bytes,
        ms: allProjects.ms + allIndustry.ms + allExternal.ms,
      },
      facultyFirstPage: { items: faculty.res.data.faculty.length, total: faculty.res.data.total, bytes: faculty.res.bytes, ms: faculty.ms },
    };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

module.exports = { loadScale, loadScaleFixture, measureDiscovery, EXPIRED_DEADLINE, LOAD_CLOCK, OPEN_DEADLINE };
