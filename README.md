# Stelic Portfolio Delivery Roadmap

Live roadmap dashboard on Vercel. Data is stored in Databricks. The whole roadmap
is behind a password, editing needs the admin password, and client dashboard
passwords are read from a separate restricted table only when someone asks.

    index.html         the dashboard (served at /)
    api/state.js       reads and saves the roadmap row in Databricks   -> /api/state
    api/secret.js      returns one dashboard password after a PIN       -> /api/secret
    api/meetings.js    lists Fireflies meetings for admins to import     -> /api/meetings
    api/_databricks.js shared Databricks SQL helper (not an endpoint)
    api/_viewauth.js   shared roadmap password check (not an endpoint)
    package.json       Node 20, no dependencies
    vercel.json        function time limits

## Databricks tables

Roadmap (one row, id = 'main'; this is the table you already use):

    id STRING, payload STRING, updated_at TIMESTAMP

Dashboard passwords (new; grant read only to the service principal the app uses):

    CREATE TABLE <catalog>.<schema>.roadmap_secrets (
      project_id STRING, secret STRING, updated_at TIMESTAMP
    );
    INSERT INTO <catalog>.<schema>.roadmap_secrets
      VALUES ('<project id from the roadmap>', '<password>', current_timestamp());

project_id must match the project's id in the roadmap data, for example amgen.

## Vercel environment variables

    DATABRICKS_HOST            workspace host, e.g. adb-1234567890.12.azuredatabricks.net
    DATABRICKS_TOKEN           service principal token
    DATABRICKS_WAREHOUSE_ID    SQL warehouse id
    DATABRICKS_ROADMAP_TABLE   catalog.schema.table holding the roadmap row
    ROADMAP_SECRETS_TABLE      catalog.schema.roadmap_secrets
    ROADMAP_VIEW_PASSWORD      password to open the roadmap
    ADMIN_PASSWORD             password to edit
    ROADMAP_ACCESS_PIN         team PIN to view a dashboard password
    FIREFLIES_API_KEY          Fireflies API key (Settings, Developer settings in Fireflies)
    FIREFLIES_MEETING_KEYWORD  optional default search, e.g. the bi-monthly call title

Remove the old GITHUB_TOKEN, GITHUB_REPO, GITHUB_PATH and GITHUB_BRANCH variables.
Redeploy after any change to these values.

## Using it

1. Open the site and enter the roadmap password.
2. Click Admin and enter the admin password to edit. Changes save to Databricks.
3. Meeting notes: as admin, click Load from Fireflies under Dependencies, search for the
   call, and click Add. The summary and action items are saved with the roadmap.
4. For a project whose dashboard needs a password, open its row menu and choose
   "Mark link as password protected", then add the password to roadmap_secrets.

If Databricks cannot be reached, the page shows a red banner and blocks saving,
so a failed load can never overwrite the stored roadmap.
