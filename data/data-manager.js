/**
 * fmc-am-6f / data/data-manager.js
 * Gerador de backups em 3 estágios e persistência mista (GitHub API + LocalStorage)
 */

const GITHUB_REPO = 'angelomiggliori/FMC-AM-6F'; // Ajustar de acordo com a branch/repo real
const GITHUB_BRANCH = 'main';

/**
 * Rotação de backups 3 estágios (bak2 -> bak3, bak1 -> bak2, atual -> bak1)
 * Funciona para LocalStorage e GitHub.
 */
async function rotacionarBackups(readFunc, writeFunc, filename, newData) {
  // Lê as versões atuais antes da rotação
  const atual = await readFunc(filename);
  const bak1 = await readFunc(`${filename}.bak1`);
  const bak2 = await readFunc(`${filename}.bak2`);

  // Desloca
  if (bak2) await writeFunc(`${filename}.bak3`, bak2);
  if (bak1) await writeFunc(`${filename}.bak2`, bak1);
  if (atual) await writeFunc(`${filename}.bak1`, atual);

  // Salva o novo
  await writeFunc(filename, newData);
}

/**
 * I/O LocalStorage
 */
export const LocalDB = {
  async read(key) {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : null;
    } catch { return null; }
  },
  async _writeRaw(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
      console.error(`Erro ao salvar no LocalStorage [${key}]`, e);
    }
  },
  async write(key, data) {
    await rotacionarBackups(
      this.read.bind(this),
      this._writeRaw.bind(this),
      key,
      data
    );
  }
};

/**
 * I/O GitHub
 */
export const GitHubDB = {
  async read(filename) {
    try {
      const res = await fetch(`data/${filename}?t=${Date.now()}`); // Cache bust simple
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  },

  async _writeRaw(filename, data) {
    const token = localStorage.getItem('fmc-github-token');
    if (!token) {
      console.warn('Escrita ignorada, PAT GitHub ausente.');
      return;
    }

    const path = `data/${filename}`;
    const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`;
    
    // Obter SHA atual se existir
    let sha = undefined;
    try {
      const getRes = await fetch(url + `?ref=${GITHUB_BRANCH}`, { headers: { 'Authorization': `token ${token}` }});
      if (getRes.ok) {
        const getBody = await getRes.json();
        sha = getBody.sha;
      }
    } catch (e) {}

    const contentB64 = btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2))));
    
    // PUT
    try {
        await fetch(url, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: `Auto-save: ${filename} ${new Date().toISOString()}`,
                content: contentB64,
                sha: sha,
                branch: GITHUB_BRANCH
            })
        });
    } catch (e) {
        console.error(`Falha no PUT para o GitHub API [${filename}]`, e);
    }
  },

  async write(filename, data) {
      await rotacionarBackups(
          this.read.bind(this),
          this._writeRaw.bind(this),
          filename,
          data
      );
  }
};
