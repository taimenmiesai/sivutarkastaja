# Sivutarkastaja

Verkkosivusto, joka arvioi toisen verkkosivun saavutettavuutta. Käyttäjä syöttää osoitteen, ja palvelu hakee sivun otsattomalla Chromium-selaimella ja raportoi:

- **Kontrastit.** Jokaisen näkyvän tekstin väri ja todellinen taustaväri (myös läpikuultavat värit ja sisäkkäiset taustat) tarkistetaan WCAG 2.2 -rajoja vasten: AA 4,5:1 (suuri teksti 3:1) ja AAA 7:1 (suuri teksti 4,5:1). Tulokset ryhmitellään väripareittain.
- **Värisokeus.** Kuvakaappaus sivusta neljällä simulaatiolla: puna-, viher- ja sinisokeus sekä täysi värisokeus (Machado ym. 2009). Lisäksi listataan väriparit, jotka läpäisevät vaatimuksen tavallisella näöllä mutta eivät värisokealle, sekä tekstin sisäiset linkit, jotka erottuvat vain värin avulla (WCAG 1.4.1).
- **Selkolukuisuus.** LIX-luku, lauseiden ja sanojen keskipituus, pisimmät lauseet ja hyvin pitkät sanat sekä parannusehdotukset. Kieli (suomi tai englanti) tunnistetaan sivun `lang`-määreestä tai tekstistä. Englanninkieliselle tekstille lasketaan myös Flesch Reading Ease.

## Käynnistys

Vaatii Node.js 20 tai uudemman.

```sh
npm install          # asentaa myös Chromiumin (playwright install chromium)
npm start            # http://localhost:3000
```

Ympäristömuuttujat:

| Muuttuja | Oletus | Merkitys |
|---|---|---|
| `PORT` | `3000` | Kuunneltava portti |
| `MAX_CONCURRENT` | `2` | Samanaikaisten tarkastusten enimmäismäärä |
| `ALLOW_PRIVATE_URLS` | – | `1` sallii localhost- ja sisäverkko-osoitteet. Vain kehitykseen (`npm run dev`). |

## Tietoturva

Palvelin hakee käyttäjän antamia osoitteita, joten se estää oletuksena kaikki pyynnöt yksityisiin verkkoihin (localhost, 10.x, 192.168.x, pilvipalveluiden metatieto-osoitteet jne.). Tarkistus tehdään jokaiselle selaimen pyynnölle, myös uudelleenohjauksille ja alaresursseille.

## Testit

```sh
npm test
```

## Rajoitukset

- Taustakuvien tai liukuvärien päällä olevan tekstin kontrastia ei voi laskea luotettavasti. Raportti merkitsee nämä tarkistettaviksi käsin.
- Päällekkäin absoluuttisesti sijoitetut elementit arvioidaan DOM-rakenteen mukaan, ei sen mukaan mitä ruudulla näkyy.
- Kirjautumista vaativia sivuja ei voi tarkastaa.
