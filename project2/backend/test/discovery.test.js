// R1-17 to R1-24: browsing, filtering, project-to-faculty links, contact, persistence and
// direct navigation, against the R1 fixture.
const assert = require("node:assert/strict");
const { after, before, describe, test } = require("node:test");
const { fixtureEmail } = require("../src/fixture");
const { createClient, loadFixtureInto, signIn, startTestApp } = require("./helpers");

describe("discovery", () => {
  let t;
  let ids;
  let anon;
  before(async () => {
    t = await startTestApp();
    ids = await loadFixtureInto(t);
    anon = createClient(t.baseUrl);
  });
  after(() => t.close());

  const projectTitles = (res) => res.data.projects.map((p) => p.title).sort();
  const facultyNames = (res) => res.data.faculty.map((f) => f.displayName).sort();
  // One shared session: signing in repeatedly would hit the real 3-codes-per-10-minutes limit.
  let studentClient;
  const student = async () => {
    studentClient ??= (await signIn(t, fixtureEmail("TEST-STUDENT"))).client;
    return studentClient;
  };

  describe("R1-17 and R1-18: students can browse faculty", () => {
    test("each listed faculty member shows research areas and a plain-language inquiry preference", async () => {
      const { faculty } = (await anon.get("/api/faculty")).data;
      const alex = faculty.find((f) => f.displayName === "Dr. Alex Morgan");
      assert.deepEqual(alex.researchAreas, ["Artificial Intelligence", "Data Science"]);
      assert.equal(alex.inquiryPreference.label, "Open to general student inquiries");
      assert.ok(!JSON.stringify(faculty).match(/"(open|projects_only|not_accepting|general|listed-projects-only)"/));
    });

    test("R1-18: a faculty member with no current project is still listed and openable", async () => {
      assert.ok(facultyNames(await anon.get("/api/faculty")).includes("Dr. Jordan Lee"));
      assert.equal((await anon.get(`/api/faculty/${ids.facultyId("F-JORDAN")}`)).status, 200);
    });
  });

  describe("R1-19: students can browse current projects", () => {
    test("each listed project has enough to decide whether to open it", async () => {
      const p = (await anon.get("/api/projects")).data.projects.find((x) => x.title.startsWith("Mobile Usability"));
      assert.equal(p.faculty.displayName, "Dr. Priya Shah");
      assert.equal(p.targetTerm, "Spring 2027");
      assert.equal(p.studentLevel, "Undergraduate or Graduate");
      assert.deepEqual(p.researchAreas, ["Human-Computer Interaction"]);
    });
  });

  describe("R1-20: filtering and search", () => {
    test("projects by research area, matched as any one of a project's areas", async () => {
      assert.deepEqual(projectTitles(await anon.get("/api/projects?area=Artificial%20Intelligence")), [
        "Explainable Models for Community Service Data",
        "Small-Data Model Evaluation",
      ]);
      assert.deepEqual(
        projectTitles(await anon.get("/api/projects?area=artificial%20intelligence")),
        projectTitles(await anon.get("/api/projects?area=Artificial%20Intelligence")),
      );
    });

    test("student level: 'Undergraduate or Graduate' projects match both levels", async () => {
      const undergrad = projectTitles(await anon.get("/api/projects?level=undergraduate"));
      const grad = projectTitles(await anon.get("/api/projects?level=graduate"));
      assert.ok(undergrad.includes("Mobile Usability Audit Toolkit") && grad.includes("Mobile Usability Audit Toolkit"));
      assert.ok(undergrad.includes("Small-Data Model Evaluation") && !grad.includes("Small-Data Model Evaluation"));
    });

    test("term, faculty and text search, combined with AND", async () => {
      assert.deepEqual(projectTitles(await anon.get("/api/projects?term=Spring%202027")), [
        "Mobile Usability Audit Toolkit",
        "Small-Data Model Evaluation",
      ]);
      const priya = ids.facultyId("F-PRIYA");
      assert.deepEqual(projectTitles(await anon.get(`/api/projects?facultyId=${priya}&term=Winter%202027`)), [
        "Accessible Navigation for Complex Web Forms",
      ]);
      // Text search covers titles, faculty names and areas, case-insensitively.
      assert.deepEqual(projectTitles(await anon.get("/api/projects?q=ACCESSIBLE")), ["Accessible Navigation for Complex Web Forms"]);
      assert.equal(projectTitles(await anon.get("/api/projects?q=priya%20shah")).length, 2);
      assert.equal(projectTitles(await anon.get("/api/projects?q=data%20science")).length, 1);
      assert.deepEqual(projectTitles(await anon.get("/api/projects?q=model&term=Spring%202027")), ["Small-Data Model Evaluation"]);
    });

    test("search text is matched literally, so % and _ are not wildcards", async () => {
      assert.equal((await anon.get("/api/projects?q=%25")).data.projects.length, 0);
      assert.equal((await anon.get("/api/projects?q=_")).data.projects.length, 0);
    });

    test("no match is an empty list, and unknown filter values are a clear 400", async () => {
      assert.deepEqual((await anon.get("/api/projects?area=Music")).data.projects, []);
      for (const query of ["area=Astrology", "level=postdoc", "facultyId=abc", `q=${"x".repeat(101)}`]) {
        const res = await anon.get(`/api/projects?${query}`);
        assert.equal(res.status, 400, query);
        assert.ok(res.data.error);
      }
    });

    test("filter choices come from what the viewer can see, with counts", async () => {
      const publicFilters = (await anon.get("/api/projects")).data.filters;
      assert.ok(!publicFilters.faculty.some((f) => f.displayName === "Dr. Mei Chen"));
      const ai = publicFilters.areas.flatMap((g) => g.areas).find((a) => a.value === "Artificial Intelligence");
      assert.equal(ai.count, 2);
      assert.deepEqual(publicFilters.terms.map((term) => term.value), ["Winter 2027", "Spring 2027"]);

      const signedInFilters = (await (await student()).get("/api/projects")).data.filters;
      assert.ok(signedInFilters.faculty.some((f) => f.displayName === "Dr. Mei Chen"));
    });

    test("faculty by area, inquiry preference and text", async () => {
      assert.deepEqual(facultyNames(await anon.get("/api/faculty?area=Cybersecurity")), ["Dr. Jordan Lee"]);
      assert.deepEqual(facultyNames(await anon.get("/api/faculty?inquiry=projects_only")), ["Dr. Priya Shah"]);
      assert.deepEqual(facultyNames(await anon.get("/api/faculty?q=accessibility")), ["Dr. Priya Shah"]);
      assert.deepEqual(facultyNames(await anon.get("/api/faculty?area=Artificial%20Intelligence")), ["Dr. Alex Morgan"]);
      assert.deepEqual(facultyNames(await (await student()).get("/api/faculty?area=Artificial%20Intelligence")), [
        "Dr. Alex Morgan",
        "Dr. Mei Chen",
      ]);
      assert.equal((await anon.get("/api/faculty?inquiry=maybe")).status, 400);
      const { filters } = (await anon.get("/api/faculty")).data;
      assert.deepEqual(filters.inquiry.map((o) => o.label), [
        "Open to general student inquiries",
        "Inquiries about listed projects only",
      ]);
    });
  });

  describe("R1-21: project detail connects to the faculty member", () => {
    test("a project names its faculty member, whose profile the same viewer can open", async () => {
      const { project } = (await anon.get(`/api/projects/${ids.projectId("P-103")}`)).data;
      assert.equal(project.faculty.displayName, "Dr. Priya Shah");
      assert.equal(project.faculty.inquiryPreference.label, "Inquiries about listed projects only");
      assert.equal((await anon.get(`/api/faculty/${project.faculty.id}`)).status, 200);
    });
  });

  describe("R1-22: contact uses normal university email", () => {
    test("open faculty: Contact on the profile and on their projects", async () => {
      const alexId = ids.facultyId("F-ALEX");
      assert.deepEqual((await anon.get(`/api/faculty/${alexId}`)).data.profile.contact, { email: fixtureEmail("F-ALEX") });
      assert.deepEqual((await anon.get(`/api/projects/${ids.projectId("P-101")}`)).data.project.contact, {
        email: fixtureEmail("F-ALEX"),
      });
    });

    test("listed-projects-only faculty: Contact on their projects, not their profile", async () => {
      assert.equal((await anon.get(`/api/faculty/${ids.facultyId("F-PRIYA")}`)).data.profile.contact, null);
      assert.deepEqual((await anon.get(`/api/projects/${ids.projectId("P-103")}`)).data.project.contact, {
        email: fixtureEmail("F-PRIYA"),
      });
    });

    test("faculty not accepting inquiries get no Contact anywhere", async () => {
      const jordanId = ids.facultyId("F-JORDAN");
      await t.db.query("UPDATE faculty_profiles SET inquiry_preference = 'not_accepting' WHERE user_id = $1", [jordanId]);
      try {
        assert.equal((await anon.get(`/api/faculty/${jordanId}`)).data.profile.contact, null);
      } finally {
        await t.db.query("UPDATE faculty_profiles SET inquiry_preference = 'open' WHERE user_id = $1", [jordanId]);
      }
    });

    test("the address is only given to viewers who may see the record", async () => {
      assert.equal((await anon.get(`/api/projects/${ids.projectId("P-105")}`)).status, 404);
      assert.equal((await anon.get(`/api/faculty/${ids.facultyId("F-MEI")}`)).status, 404);
      const signedIn = await student();
      assert.deepEqual((await signedIn.get(`/api/projects/${ids.projectId("P-105")}`)).data.project.contact, {
        email: fixtureEmail("F-MEI"),
      });
    });

    test("an owner previewing their own draft gets no Contact", async () => {
      const { client } = await signIn(t, fixtureEmail("F-ALEX"));
      const draft = (await client.get(`/api/projects/${ids.projectId("P-102")}`)).data.project;
      assert.equal(draft.status, "draft");
      assert.equal(draft.contact, null);
    });
  });

  describe("R1-23 and R1-24: persistence and direct navigation", () => {
    test("profile and project changes survive a fresh session", async () => {
      const { client } = await signIn(t, fixtureEmail("F-JORDAN"));
      const mine = (await client.get("/api/faculty/me/profile")).data.profile;
      await client.put("/api/faculty/me/profile", {
        displayName: mine.displayName,
        description: "Studies secure software, applied privacy and threat modelling.",
        researchAreas: mine.researchAreas,
        inquiryPreference: "open",
        externalLinks: mine.externalLinks,
      });
      await client.post("/api/auth/logout");

      const fresh = await signIn(t, fixtureEmail("F-JORDAN"));
      const reread = (await fresh.client.get("/api/faculty/me/profile")).data.profile;
      assert.match(reread.description, /threat modelling/);
      const publicView = (await createClient(t.baseUrl).get(`/api/faculty/${ids.facultyId("F-JORDAN")}`)).data.profile;
      assert.match(publicView.description, /threat modelling/);
    });

    test("opening a record by id applies the same visibility as the lists", async () => {
      for (const fixtureId of ["P-102", "P-106", "P-108", "P-105"]) {
        assert.equal((await anon.get(`/api/projects/${ids.projectId(fixtureId)}`)).status, 404, fixtureId);
      }
      assert.equal((await anon.get(`/api/faculty/${ids.facultyId("U-PENDING")}`)).status, 404);
      const signedIn = await student();
      assert.equal((await signedIn.get(`/api/faculty/${ids.facultyId("U-PENDING")}`)).status, 404);
      assert.equal((await signedIn.get(`/api/projects/${ids.projectId("P-106")}`)).status, 404);
    });
  });

  test("the form option lists are served from the server's catalog", async () => {
    const { data } = await anon.get("/api/options");
    assert.deepEqual(data.studentLevels, ["Undergraduate", "Graduate", "Undergraduate or Graduate"]);
    assert.ok(data.researchAreaGroups.flatMap((g) => g.areas).includes("Cybersecurity"));
    assert.deepEqual(data.termSeasons, ["Winter", "Spring", "Summer", "Fall"]);
    assert.equal(data.termYears.length, 4);
  });
});
