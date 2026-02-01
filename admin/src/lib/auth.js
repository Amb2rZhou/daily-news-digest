/**
 * Simple token-based auth for admin UI.
 * Uses a GitHub Personal Access Token stored in localStorage.
 * Validates that the token owner matches the repo owner.
 */

const STORAGE_KEY = 'news_admin_token'
const OWNER_KEY = 'news_admin_owner'
const REPO_KEY = 'news_admin_repo'

export function getStoredAuth() {
  return {
    token: localStorage.getItem(STORAGE_KEY) || '',
    owner: localStorage.getItem(OWNER_KEY) || '',
    repo: localStorage.getItem(REPO_KEY) || '',
  }
}

export function saveAuth({ token, owner, repo }) {
  localStorage.setItem(STORAGE_KEY, token)
  localStorage.setItem(OWNER_KEY, owner)
  localStorage.setItem(REPO_KEY, repo)
}

export function clearAuth() {
  localStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem(OWNER_KEY)
  localStorage.removeItem(REPO_KEY)
}
