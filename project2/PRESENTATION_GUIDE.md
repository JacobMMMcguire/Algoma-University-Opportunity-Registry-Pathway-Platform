# Presenting the guided tour

How to run the tour for practice and on the day. The tour walks through the site in four chapters:
**Visitor → Student → Faculty → Staff**. Press **Next** on the card to move on; **Back** goes back;
**Esc** or **End tour** closes it. **Take the tour** in the menu starts it again at any time.

There are two ways to run it. Pick one.

| | Live site | Your own computer |
|---|---|---|
| Address | https://algoma-opportunity-registry-r1-backend.onrender.com | http://localhost:3001 |
| Switching roles | Sign in to each test account (below) | Automatic: press **Continue as ...** |
| Good for | The real presentation (it's the graded Final build) | Quick practice, no sign-ins |

## Test accounts

These are made-up accounts loaded by the fixtures. They have no inbox, so you never get an email:
you read the sign-in code on the **operator page** instead.

| Chapter | Sign in as |
|---|---|
| Student | `fixture-s01@algomau.ca` |
| Faculty | `fixture-f-jordan@algomau.ca` |
| Staff | `fixture-test-staff@algomau.ca` |

Don't use your own Algoma account for the tour: it is a real account with its own role, so the
tour treats it as that role.

## Running it on the live site

You need the **operator access code**. Ask Jacob in the private team channel. **Never put it in this
file, GitHub, a screenshot, a slide or a chat with an AI.**

1. Open the site. The **Take a guided tour** card appears on your first visit (or choose **Take the
   tour** in the menu). Press **Start the tour**.
2. Go through the **Visitor** chapter with **Next**. No sign-in is needed.
3. In a **second tab**, open `/operator.html` on the same site and enter the operator access code.
   Leave this tab open for the rest of the tour.
4. When the card says **Chapter: Student**, press **Sign in as a student**.
5. On the sign-in page, enter `fixture-s01@algomau.ca` and press **Email me a code**. (Nothing is
   emailed; the page says it's a test account.)
6. In the second tab, refresh the list and copy the 6-digit code for that address.
7. Back in the first tab, enter the code. The tour carries on from where you left off.
8. Do the same at **Chapter: Faculty** (`fixture-f-jordan@algomau.ca`) and **Chapter: Staff**
   (`fixture-test-staff@algomau.ca`).
9. On the last card, press **Finish**. Sign out from the menu when you're done.

Don't want to sign in? Press **Read about it here** on a chapter card and that chapter is
explained on the card instead.

## Running it on your own computer

You need Node 22 and the repository. No passwords or codes.

1. In a terminal, go to `project2/backend` and run `npm install` (first time only), then
   `npm run dev:local`.
2. Open http://localhost:3001 and press **Start the tour**.
3. At each chapter card, press **Continue as ...**. It switches accounts for you.
4. Stop it with **Ctrl+C** in the terminal. Everything resets each time you start it, so every
   practice run begins the same way.

The automatic switching only exists on your own computer. The live site doesn't have it, on purpose:
signing in without a code must never be possible there.

## On the day

- **Open the live site a few minutes early.** The free server sleeps and takes about a minute to
  wake up.
- **Check the external (Mitacs) data is fresh.** If cards say "This information may be out of
  date", sign in as staff, open **External sync health** and run **Feed v1 (last week)** once.
- **Have the operator page open in a second tab** before you start.
- **Use a private or incognito window** so the tour offers itself fresh and you aren't signed in as
  anyone.

## If something goes wrong

| Problem | Fix |
|---|---|
| The tour card doesn't appear | Choose **Take the tour** in the menu. |
| I closed the tour by mistake | **Take the tour** starts again from the beginning; press **Next** to get back. |
| "That code is invalid or has expired" | Codes last 10 minutes. Request a new one and copy the newest. |
| "Too many sign-in codes requested" | Each address gets 3 codes per 10 minutes. Wait, or use another tab where you're already signed in. |
| The sign-in page says "You're signed in" | Sign out from the menu first, then sign in as the test account. |
| A page shows "may be out of date" | Run the staff sync (see "On the day"). |
| The site is slow to load | It's waking up. Wait a minute and refresh. |
