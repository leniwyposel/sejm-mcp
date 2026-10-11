// Teksty aktów z PDF nie trafiają do schowka w testach: wpis z jednego testu (ten sam adres ELI
// i ta sama changeDate z fikstury) podmieniałby plik w następnym. Test schowka włącza go sam.
import { ustawSchowekAktow } from '../src/akty-schowek.js';

ustawSchowekAktow(() => null);
