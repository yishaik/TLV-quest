const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const token = required("SENTRY_AUTH_TOKEN");
const organization = required("SENTRY_ORG");
const project = required("SENTRY_PROJECT");
const releaseVersion = required("SENTRY_RELEASE");
const alertName =
  process.env.SENTRY_ALERT_NAME?.trim() || "TLV Quest live-run 5xx";
const monitorSlug =
  process.env.SENTRY_MONITOR_SLUG?.trim() || "tlv-quest-maintenance";
const sentryUrl = (
  process.env.SENTRY_URL?.trim() || "https://sentry.io"
).replace(/\/+$/, "");

const getJson = async (path) => {
  const response = await fetch(`${sentryUrl}${path}`, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Sentry API ${response.status} for ${path}: ${body.slice(0, 300)}`
    );
  }

  return response.json();
};

const encodedOrganization = encodeURIComponent(organization);
const encodedProject = encodeURIComponent(project);
const encodedRelease = encodeURIComponent(releaseVersion);
const encodedMonitor = encodeURIComponent(monitorSlug);

const release = await getJson(
  `/api/0/organizations/${encodedOrganization}/releases/${encodedRelease}/?project=${encodedProject}`
);
assert(
  release.version === releaseVersion,
  `Expected release ${releaseVersion}, received ${String(release.version)}`
);

const deploys = await getJson(
  `/api/0/organizations/${encodedOrganization}/releases/${encodedRelease}/deploys/`
);
assert(Array.isArray(deploys), "Sentry release deploy response is not a list");
const productionDeploy = deploys.find(
  (deploy) => deploy?.environment === "production"
);
assert(
  productionDeploy,
  `Release ${releaseVersion} has no production deployment`
);

const workflowParams = new URLSearchParams({
  project,
  query: alertName
});
const workflowResponse = await getJson(
  `/api/0/organizations/${encodedOrganization}/workflows/?${workflowParams}`
);
const workflows = Array.isArray(workflowResponse)
  ? workflowResponse
  : (workflowResponse.results ?? workflowResponse.data ?? []);
const alert = workflows.find((workflow) => workflow?.name === alertName);
assert(alert, `Enabled Sentry alert was not found: ${alertName}`);
assert(alert.enabled === true, `Sentry alert is disabled: ${alertName}`);
assert(Boolean(alert.owner), `Sentry alert has no owner: ${alertName}`);

const alertJson = JSON.stringify(alert).toLowerCase();
assert(
  alertJson.includes("event_frequency"),
  `Sentry alert has no event-frequency condition: ${alertName}`
);
assert(
  alertJson.includes("operational_scope") && alertJson.includes("live_run"),
  `Sentry alert is not filtered to operational_scope=live_run: ${alertName}`
);
assert(
  alertJson.includes("production"),
  `Sentry alert is not restricted to production: ${alertName}`
);
const alertActions = [
  ...(alert.triggers?.actions ?? []),
  ...(alert.actionFilters ?? []).flatMap((filter) => filter?.actions ?? [])
];
assert(
  alertActions.some((action) => action?.status !== "disabled"),
  `Sentry alert has no active notification action: ${alertName}`
);

const monitor = await getJson(
  `/api/0/projects/${encodedOrganization}/${encodedProject}/monitors/${encodedMonitor}/`
);
assert(
  monitor.slug === monitorSlug || monitor.id === monitorSlug,
  `Sentry monitor was not found: ${monitorSlug}`
);
assert(
  monitor.status !== "disabled" && monitor.isMuted !== true,
  `Sentry monitor is disabled or muted: ${monitorSlug}`
);

console.log(
  JSON.stringify(
    {
      ok: true,
      release: releaseVersion,
      productionDeploy: {
        environment: productionDeploy.environment,
        name: productionDeploy.name ?? null,
        url: productionDeploy.url ?? null
      },
      alert: {
        name: alert.name,
        owner: alert.owner
      },
      monitor: {
        slug: monitor.slug ?? monitorSlug,
        status: monitor.status ?? "active"
      }
    },
    null,
    2
  )
);
