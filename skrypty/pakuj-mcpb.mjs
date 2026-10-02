// Paczka dla Claude Desktop (.mcpb): serwer z zależnościami, ikona i manifest.
// Użytkownik klika dwa razy plik i instaluje; Claude Desktop ma własny Node.js.
//
//   npm run build && npm run mcpb   →   build/sejm-mcp.mcpb
//
// Lista narzędzi w manifeście powstaje z kodu, więc nie rozjedzie się z serwerem.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pierwszeZdanie } from './opis-narzedzia.mjs';

const KORZEN = join(import.meta.dirname, '..');
const ETAP = join(KORZEN, 'build', 'mcpb');
const WYJSCIE = join(KORZEN, 'build', 'sejm-mcp.mcpb');

const pakiet = JSON.parse(readFileSync(join(KORZEN, 'package.json'), 'utf8'));
const { NARZEDZIA } = await import(join(KORZEN, 'dist', 'narzedzia', 'index.js'));

rmSync(join(KORZEN, 'build'), { recursive: true, force: true });
mkdirSync(ETAP, { recursive: true });
cpSync(join(KORZEN, 'dist'), join(ETAP, 'dist'), { recursive: true });
cpSync(join(KORZEN, 'LICENSE'), join(ETAP, 'LICENSE'));
cpSync(join(KORZEN, 'NOTICE'), join(ETAP, 'NOTICE'));
cpSync(join(KORZEN, '.github', 'assets', 'ikona.png'), join(ETAP, 'icon.png'));
writeFileSync(
  join(ETAP, 'package.json'),
  JSON.stringify({ name: pakiet.name, version: pakiet.version, type: 'module', private: true, dependencies: pakiet.dependencies }, null, 2),
);
execFileSync('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: ETAP, stdio: 'inherit' });

const manifest = {
  manifest_version: '0.3',
  name: 'sejm-mcp',
  display_name: 'Sejm RP',
  version: pakiet.version,
  description: 'Posłowie, głosowania, interpelacje, projekty ustaw i obowiązujące prawo z oficjalnych danych Sejmu RP.',
  long_description:
    'Pozwala Claude odpowiadać na pytania o Sejm i polskie prawo na podstawie oficjalnych danych Kancelarii Sejmu ' +
    '(api.sejm.gov.pl), z linkiem do źródła. Działa na Twoim komputerze, tylko czyta, nie wymaga konta ani klucza.',
  author: { name: 'Leniwy Poseł', url: 'https://github.com/leniwyposel' },
  repository: { type: 'git', url: 'https://github.com/leniwyposel/sejm-mcp' },
  homepage: 'https://leniwyposel.pl/dla-developerow/',
  documentation: 'https://github.com/leniwyposel/sejm-mcp#readme',
  support: 'https://github.com/leniwyposel/sejm-mcp/issues',
  privacy_policies: ['https://leniwyposel.pl/polityka-prywatnosci/'],
  icon: 'icon.png',
  server: {
    type: 'node',
    entry_point: 'dist/index.js',
    mcp_config: { command: 'node', args: ['${__dirname}/dist/index.js'] },
  },
  tools: NARZEDZIA.map((n) => ({ name: n.nazwa, description: pierwszeZdanie(n.opis) })),
  keywords: ['sejm', 'parlament', 'polska', 'prawo', 'eli'],
  license: 'Apache-2.0',
  compatibility: { platforms: ['darwin', 'win32', 'linux'], runtimes: { node: '>=22.0.0' } },
};
writeFileSync(join(ETAP, 'manifest.json'), JSON.stringify(manifest, null, 2));

const mcpb = join(KORZEN, 'node_modules', '.bin', 'mcpb');
execFileSync(mcpb, ['validate', join(ETAP, 'manifest.json')], { stdio: 'inherit' });
execFileSync(mcpb, ['pack', ETAP, WYJSCIE], { stdio: 'inherit' });
console.log(`Gotowe: ${WYJSCIE}`);
