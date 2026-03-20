import * as fs from 'fs';
import * as path from 'path';
import { debugLog } from './logger.js';

/**
 * Config file path: ~/.pi/agent/extensions/gemini-cli-search/config.json
 */
const CONFIG_DIR = path.join(
  process.env.HOME || '',
  '.pi/agent/extensions/gemini-cli-search'
);

const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

/**
 * Config schema - extensible for future settings
 */
export interface Config {
  override?: boolean;
  [key: string]: unknown;
}

/**
 * Load config from disk
 * Returns empty object if file doesn't exist or is invalid JSON
 */
export function loadConfig(): Config {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      debugLog('config', 'Config file does not exist');
      return {};
    }
    
    const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const config = JSON.parse(content) as Config;
    debugLog('config', `Loaded config with ${Object.keys(config).length} keys`);
    return config;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    debugLog('config', `Failed to load config: ${message}`);
    return {};
  }
}

/**
 * Save config to disk
 * Creates directory if it doesn't exist
 */
export function saveConfig(config: Config): void {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    const content = JSON.stringify(config, null, 2);
    fs.writeFileSync(CONFIG_FILE, content, 'utf-8');
    debugLog('config', `Saved config to ${CONFIG_FILE}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    debugLog('config', `Failed to save config: ${message}`);
    throw err;
  }
}

/**
 * Get a specific config value
 */
export function getConfig<T = unknown>(key: string): T | undefined {
  const config = loadConfig();
  return config[key] as T | undefined;
}

/**
 * Set a specific config value and persist to disk
 */
export function setConfig(key: string, value: unknown): void {
  const config = loadConfig();
  config[key] = value;
  saveConfig(config);
}
