# Task Tracker Web

Standalone internal task tracking app built with Next.js, Prisma, PostgreSQL, Auth.js, and dynamic RBAC.

## Features

- Username/password login.
- Admin-managed users, password resets, enable/disable state, separately permissioned project management, and roles.
- Dynamic roles with permissions:
  - `task.view.all`
  - `task.view.own`
  - `task.create`
  - `task.update`
  - `task.delete`
  - `project.manage`
  - `user.manage`
  - `role.manage`
  - `export.run`
- Per-user settings for employees, dynamic statuses, dashboard sections, and Kanban columns.
- Admin-managed global projects with one current project assigned to each user.
- Task dashboard grouped by overdue, today, upcoming, after upcoming, future start date, status, project, owner, and employee.
- Parent/child task hierarchy with child-task completion progress, approval workflow, due-date validation, due extension history, quick due-date updates, and recurring tasks.
- Markdown and JSON exports stored in PostgreSQL and downloadable from the admin page.

## Local Setup

1. Copy `.env.example` to `.env` and change secrets/passwords.
2. Start Docker Desktop.
3. Start the full stack:

```powershell
docker compose up -d
```

The app container runs database migrations and seeds the first admin automatically.

For local development without the app container, start only PostgreSQL:

```powershell
docker compose up -d db
```

Then apply migrations and seed:

```powershell
npm run db:deploy
npm run db:seed
```

Run the development server:

```powershell
npm run dev
```

Open `http://localhost:3000`.

Default development login from `.env`:

- Username: `admin`
- Password: `ChangeMe123!`

Change these values before using the app with real data.

## Useful Commands

```powershell
npm run lint
npm run build
npm run db:generate
npm run db:deploy
npm run db:seed
npm run db:studio
```

## Data Model

PostgreSQL is the source of truth. Markdown is only an export format, not the live task store.

Core tables:

- `User`
- `Role`
- `Permission`
- `Project`
- `Employee`
- `TaskStatusOption`
- `DashboardSectionPreference`
- `KanbanColumnPreference`
- `Task`
- `TaskApproval`
- `TaskComment`
- `TaskHistory`
- `TeamRelation`
- `ExportJob`

## Deployment Notes

For internal LAN deployment, keep PostgreSQL behind the same network boundary as the app, rotate `AUTH_SECRET`, replace the default admin password, and schedule regular PostgreSQL backups in addition to the in-app Markdown/JSON exports.
