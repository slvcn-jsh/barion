const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const gatewayHealthUrl = process.env.BARION_AI_GATEWAY_HEALTH_URL || 'http://127.0.0.1:8790/v1/health';
const gatewayAuthCheckUrl = new URL('/v1/auth-check', gatewayHealthUrl).toString();
const gatewayAccessToken = process.env.EXPO_PUBLIC_BARION_AI_GATEWAY_TOKEN
  || readEnvValue(path.join(process.cwd(), '.env'), 'EXPO_PUBLIC_BARION_AI_GATEWAY_TOKEN');
const gatewayStartupTimeoutMs = 15_000;
const args = process.argv.slice(2);
const webIndex = args.indexOf('--web');
const useWebProxy = webIndex >= 0;
if (useWebProxy) args.splice(webIndex, 1);

let gateway;
let expo;
let closing = false;

async function main() {
  const existingHealth = await readGatewayHealth();
  if (existingHealth) {
    reportGateway(existingHealth, 'Reusing AI gateway');
    await reportGatewayAuth('Existing AI gateway');
  } else {
    gateway = spawn(
      'python',
      ['-m', 'uvicorn', 'services.ai_gateway.main:app', '--host', '127.0.0.1', '--port', '8790'],
      { cwd: process.cwd(), stdio: 'inherit', windowsHide: true },
    );
    gateway.on('error', (error) => {
      console.error(`[Barion] AI gateway failed to start: ${error.message}`);
    });
    gateway.on('exit', (code) => {
      if (!closing) {
        console.error(`[Barion] AI gateway stopped${code === null ? '' : ` with code ${code}`}. Smart Generation will use basic fallback.`);
      }
    });

    const health = await waitForGateway();
    if (health) {
      reportGateway(health, 'AI gateway ready');
      await reportGatewayAuth('AI gateway');
    } else {
      console.error('[Barion] AI gateway did not become ready. Expo will continue with basic local generation.');
    }
  }

  expo = useWebProxy
    ? spawn(process.execPath, [path.join('scripts', 'start-web.js'), ...args], {
        cwd: process.cwd(),
        stdio: 'inherit',
        windowsHide: true,
      })
    : spawn(process.execPath, [require.resolve('expo/bin/cli'), 'start', '--dev-client', ...args], {
        cwd: process.cwd(),
        stdio: 'inherit',
        windowsHide: true,
      });

  expo.on('error', (error) => {
    console.error(`[Barion] Expo failed to start: ${error.message}`);
    shutdown(1);
  });
  expo.on('exit', (code) => shutdown(code || 0));
}

async function reportGatewayAuth(label) {
  if (!gatewayAccessToken) {
    console.warn(`[Barion] ${label} reachable, but local gateway token is missing. Smart Generation will use basic fallback.`);
    return;
  }
  if (await gatewayAcceptsConfiguredToken()) return;
  console.error(`[Barion] ${label} rejected configured local token or is stale. Restart gateway or align static tokens. Smart Generation will use basic fallback.`);
}

function gatewayAcceptsConfiguredToken() {
  return new Promise((resolve) => {
    const request = http.get(gatewayAuthCheckUrl, {
      timeout: 1_500,
      headers: { Authorization: `Bearer ${gatewayAccessToken}` },
    }, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(false));
  });
}

function readEnvValue(filename, name) {
  try {
    const line = fs.readFileSync(filename, 'utf8')
      .split(/\r?\n/)
      .find((entry) => entry.trimStart().startsWith(`${name}=`));
    return line?.slice(line.indexOf('=') + 1).trim() || undefined;
  } catch {
    return undefined;
  }
}

function readGatewayHealth() {
  return new Promise((resolve) => {
    const request = http.get(gatewayHealthUrl, { timeout: 1_500 }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        if (response.statusCode !== 200) {
          resolve(null);
          return;
        }
        try {
          const health = JSON.parse(body);
          resolve(health?.gateway === 'ok' ? health : null);
        } catch {
          resolve(null);
        }
      });
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(null));
  });
}

async function waitForGateway() {
  const deadline = Date.now() + gatewayStartupTimeoutMs;
  while (Date.now() < deadline) {
    const health = await readGatewayHealth();
    if (health) return health;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

function reportGateway(health, label) {
  const provider = health?.generationProvider;
  if (provider?.status === 'configured') {
    console.log(`[Barion] ${label}: ${provider.provider}/${provider.model}`);
    return;
  }
  console.warn(`[Barion] ${label}, but provider is not configured. Smart Generation will use basic fallback.`);
}

function shutdown(exitCode) {
  if (closing) return;
  closing = true;
  if (expo && !expo.killed) expo.kill('SIGINT');
  if (gateway && !gateway.killed) gateway.kill('SIGINT');
  setTimeout(() => process.exit(exitCode), 100).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

main().catch((error) => {
  console.error(`[Barion] Development startup failed: ${error instanceof Error ? error.message : String(error)}`);
  shutdown(1);
});
