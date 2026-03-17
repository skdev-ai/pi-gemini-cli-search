import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

/**
 * Checks if the Gemini CLI binary is available in PATH.
 * Uses `which gemini` to verify presence.
 */
export function checkCliBinary(): boolean {
  try {
    execSync('which gemini', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks if the OAuth credentials file exists at ~/.gemini/oauth_creds.json.
 * Properly expands the tilde (~) to the home directory path.
 */
export function checkCredentialFile(): boolean {
  const homeDir = process.env.HOME;
  if (!homeDir) {
    return false;
  }
  
  const credPath = `${homeDir}/.gemini/oauth_creds.json`;
  return existsSync(credPath);
}

/**
 * Performs a comprehensive availability check for the Gemini CLI tool.
 * Returns an object with availability status and optional reason for failure.
 * 
 * Checks performed in order:
 * 1. CLI binary presence (gemini in PATH)
 * 2. OAuth credentials file (~/.gemini/oauth_creds.json)
 * 
 * @returns Object with `available` boolean and optional `reason` string
 */
export function checkAvailability(): { available: boolean; reason?: string } {
  // Check if gemini CLI is installed
  if (!checkCliBinary()) {
    return {
      available: false,
      reason: 'CLI_NOT_FOUND',
    };
  }

  // Check for OAuth credentials
  if (!checkCredentialFile()) {
    return {
      available: false,
      reason: 'NOT_AUTHENTICATED',
    };
  }

  return { available: true };
}

/**
 * Simple boolean check for Gemini CLI availability.
 * Wrapper around checkAvailability() that returns only the boolean.
 */
export function isAvailable(): boolean {
  return checkAvailability().available;
}
