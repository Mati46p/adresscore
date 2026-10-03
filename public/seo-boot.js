// HTML adresu pochodzi z funkcji Vercel. Ładujemy aktualne zasoby Vite z index.html,
// aby statyczny plik nie musiał znać nazw zasobów z hashem po każdym buildzie.
fetch('/')
  .then((odpowiedz) => {
    if (!odpowiedz.ok) throw new Error(`HTML aplikacji: ${odpowiedz.status}`)
    return odpowiedz.text()
  })
  .then((html) => {
    const dokument = new DOMParser().parseFromString(html, 'text/html')
    for (const arkusz of dokument.querySelectorAll('link[rel="stylesheet"][href]')) {
      if (!document.querySelector(`link[rel="stylesheet"][href="${arkusz.getAttribute('href')}"]`))
        document.head.append(arkusz.cloneNode(true))
    }
    const aplikacja = dokument.querySelector('script[type="module"][src]')
    if (!aplikacja) throw new Error('Brak skryptu aplikacji')
    const skrypt = document.createElement('script')
    skrypt.type = 'module'
    skrypt.src = aplikacja.getAttribute('src')
    document.body.append(skrypt)
  })
  .catch((blad) =>
    console.error('Nie udało się uruchomić aplikacji; katalog HTML nadal działa.', blad),
  )
