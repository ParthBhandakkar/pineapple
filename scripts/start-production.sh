#!/bin/sh
set -eu

npm run db:push
npm run db:seed
npx tsx scripts/promote-first-user.ts || true

exec npm run start -- -p 3000
