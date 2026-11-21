# Getting started in Claude Code (one time)

1. Install Node.js (LTS) from nodejs.org, and Git (git-scm.com) if you don't have it.
2. Open Terminal and run:
       cd ~/Documents
       git clone https://github.com/baylor-byx/baylor-byx.github.io rush-portal
       cd rush-portal
3. Unzip this kit and copy everything inside it (CLAUDE.md, SETUP.md, package.json, firestore.rules,
   .gitignore and the tests folder) into the rush-portal folder.
4. Run:
       npm install
       npm test
   You should see "All test files passed".
5. Start Claude Code in that folder:
       claude
   Then ask it something like: "Read CLAUDE.md, run the tests, and tell me what you see."

Keep uploading to the live site the same way you do now until we set up automatic deploys.
