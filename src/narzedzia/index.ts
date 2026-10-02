import { glosowanie, glosowaniaPosiedzenia, glosyPoslaWDniu, listaPosiedzen, szukajGlosowan } from './glosowania.js';
import { akt, slownikEli, szukajAktow, trescAktu } from './eli.js';
import { grupyBilateralne, kadencje, komisje, porzadekPosiedzenia, transmisje } from './izba.js';
import { druk, proces, szukajDrukow, szukajProcesow, szukajProjektow } from './legislacja.js';
import { tekstDruku } from './druki.js';
import { pismo, szukajPism } from './pisma.js';
import { posiedzeniaKomisji, trescWypowiedzi, wypowiedziPosiedzenia } from './posiedzenia.js';
import { kluby, profilPosla, znajdzPosla } from './poslowie.js';
import { zapytanieSurowe } from './surowe.js';
import type { Narzedzie } from './wspolne.js';

export const NARZEDZIA: Narzedzie<any>[] = [
  znajdzPosla,
  profilPosla,
  kluby,
  komisje,
  grupyBilateralne,
  kadencje,
  listaPosiedzen,
  porzadekPosiedzenia,
  glosowaniaPosiedzenia,
  szukajGlosowan,
  glosowanie,
  glosyPoslaWDniu,
  szukajPism,
  pismo,
  szukajProcesow,
  proces,
  szukajProjektow,
  druk,
  tekstDruku,
  szukajDrukow,
  posiedzeniaKomisji,
  wypowiedziPosiedzenia,
  trescWypowiedzi,
  transmisje,
  szukajAktow,
  akt,
  trescAktu,
  slownikEli,
  zapytanieSurowe,
];
