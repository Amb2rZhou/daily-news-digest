/**
 * GitHub API helper for reading/writing repo files and triggering workflows.
 * All operations use the GitHub REST API with a personal access token.
 */

const API = 'https://api.github.com'

let _token = null
let _owner = null
let _repo = null

export function configure({ token, owner, repo }) {
  _token = token
  _owner = owner
  _repo = repo
}

export function isConfigured() {
  return !!(_token && _owner && _repo)
}

function headers() {
  return {
    Authorization: `Bearer ${_token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

/** Get authenticated user info */
export async function getUser() {
  const res = await fetch(`${API}/user`, { headers: headers() })
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
  return res.json()
}

/** Read a file from the repo (returns { content, sha }) */
export async function readFile(path) {
  const res = await fetch(
    `${API}/repos/${_owner}/${_repo}/contents/${path}`,
    { headers: headers() }
  )
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
  const data = await res.json()
  const content = decodeURIComponent(escape(atob(data.content)))
  return { content, sha: data.sha }
}

/** Write a file to the repo */
export async function writeFile(path, content, message, sha = null) {
  const body = {
    message,
    content: btoa(unescape(encodeURIComponent(content))),
  }
  if (sha) body.sha = sha
  const res = await fetch(
    `${API}/repos/${_owner}/${_repo}/contents/${path}`,
    { method: 'PUT', headers: headers(), body: JSON.stringify(body) }
  )
  if (!res.ok) {
    const err = await res.json()
    throw new Error(`GitHub API error: ${res.status} - ${err.message}`)
  }
  return res.json()
}

/** List files in a directory */
export async function listFiles(path) {
  const res = await fetch(
    `${API}/repos/${_owner}/${_repo}/contents/${path}`,
    { headers: headers() }
  )
  if (res.status === 404) return []
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
  return res.json()
}

/** Trigger a workflow dispatch event */
export async function triggerWorkflow(workflowFile, ref = 'main', inputs = {}) {
  const res = await fetch(
    `${API}/repos/${_owner}/${_repo}/actions/workflows/${workflowFile}/dispatches`,
    {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ ref, inputs }),
    }
  )
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Trigger failed: ${res.status} - ${err}`)
  }
  return true
}

/** Get recent workflow runs */
export async function getWorkflowRuns(workflowFile, perPage = 10) {
  const res = await fetch(
    `${API}/repos/${_owner}/${_repo}/actions/workflows/${workflowFile}/runs?per_page=${perPage}`,
    { headers: headers() }
  )
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
  return res.json()
}

/** Read the daily-news.yml workflow file to get cron schedule */
export async function readWorkflowCron(workflowFile = 'fetch-news.yml') {
  const file = await readFile(`.github/workflows/${workflowFile}`)
  if (!file) return null
  const match = file.content.match(/cron:\s*'([^']+)'/)
  return match ? match[1] : null
}

/** List repository action secrets (names only, values are write-only) */
export async function listSecrets() {
  const res = await fetch(
    `${API}/repos/${_owner}/${_repo}/actions/secrets`,
    { headers: headers() }
  )
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
  const data = await res.json()
  return data.secrets || []
}

/** Get the repository public key for encrypting secrets */
export async function getPublicKey() {
  const res = await fetch(
    `${API}/repos/${_owner}/${_repo}/actions/secrets/public-key`,
    { headers: headers() }
  )
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
  return res.json()
}

/** Create or update a repository secret (value must be encrypted) */
export async function setSecret(name, encryptedValue, keyId) {
  const res = await fetch(
    `${API}/repos/${_owner}/${_repo}/actions/secrets/${name}`,
    {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({ encrypted_value: encryptedValue, key_id: keyId }),
    }
  )
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Set secret failed: ${res.status} - ${err}`)
  }
  return true
}

/** Update the cron schedule in a workflow file */
export async function updateWorkflowCron(newCron, workflowFile = 'fetch-news.yml') {
  const path = `.github/workflows/${workflowFile}`
  const file = await readFile(path)
  if (!file) throw new Error('Workflow file not found')
  const updated = file.content.replace(
    /cron:\s*'[^']+'/,
    `cron: '${newCron}'`
  )
  return writeFile(path, updated, `Update cron schedule to ${newCron}`, file.sha)
}
