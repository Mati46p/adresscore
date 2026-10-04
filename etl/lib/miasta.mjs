// Tabela 9 miast (slug ADRESCORE_MIASTO) z kluczami do rejestrów ogólnopolskich.
// teryt4 = powiat (4 cyfry TERYT), bdl = jednostka poziomu 5 w GUS BDL i jej nazwa w BDL.
export const MIASTA = {
  warszawa: {
    nazwa: 'Warszawa',
    teryt4: '1465',
    bdl: '071412865000',
    bdlNazwa: 'Powiat m. st. Warszawa',
    woj: '14',
  },
  lodz: {
    nazwa: 'Łódź',
    teryt4: '1061',
    bdl: '051011661000',
    bdlNazwa: 'Powiat m. Łódź',
    woj: '10',
  },
  wroclaw: {
    nazwa: 'Wrocław',
    teryt4: '0264',
    bdl: '030210564000',
    bdlNazwa: 'Powiat m. Wrocław',
    woj: '02',
  },
  poznan: {
    nazwa: 'Poznań',
    teryt4: '3064',
    bdl: '023016264000',
    bdlNazwa: 'Powiat m. Poznań',
    woj: '30',
  },
  gdansk: {
    nazwa: 'Gdańsk',
    teryt4: '2261',
    bdl: '042214361000',
    bdlNazwa: 'Powiat m. Gdańsk',
    woj: '22',
  },
  szczecin: {
    nazwa: 'Szczecin',
    teryt4: '3262',
    bdl: '023216562000',
    bdlNazwa: 'Powiat m. Szczecin',
    woj: '32',
  },
  bydgoszcz: {
    nazwa: 'Bydgoszcz',
    teryt4: '0461',
    bdl: '040410661000',
    bdlNazwa: 'Powiat m. Bydgoszcz',
    woj: '04',
  },
  lublin: {
    nazwa: 'Lublin',
    teryt4: '0663',
    bdl: '060611163000',
    bdlNazwa: 'Powiat m. Lublin',
    woj: '06',
  },
  bialystok: {
    nazwa: 'Białystok',
    teryt4: '2061',
    bdl: '062013761000',
    bdlNazwa: 'Powiat m. Białystok',
    woj: '20',
  },
}

/** Wszystkie powiaty (poziom 5) z BDL by-variable dla roku – strony scalone, bufor w etl/.cache. */
export async function bdlPowiaty(zmienna, rok, pobierz) {
  const { readFileSync } = await import('node:fs')
  const wyniki = []
  for (let strona = 0; strona < 20; strona++) {
    const url = `https://bdl.stat.gov.pl/api/v1/data/by-variable/${zmienna}?unit-level=5&year=${rok}&format=json&lang=pl&page-size=100&page=${strona}`
    const plik = await pobierz(url, `bdl-${zmienna}-${rok}-powiaty-${strona}.json`)
    const d = JSON.parse(readFileSync(plik, 'utf8'))
    wyniki.push(...(d.results ?? []))
    if (!d.links?.next) break
  }
  return { results: wyniki }
}
