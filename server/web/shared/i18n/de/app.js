// Rahmen der Web-App: Anmeldung, Einrichtung, Design-Wahl, Navigation, Dialoge (app.js, setup.js, ui.js, api.js, index.html …)
export default {
  // Kopfzeile und untere Leiste (index.html)
  shell: {
    connection: 'Verbindung',
    mainNav: 'Hauptnavigation',
    // Fenstertitel des Browsers für Unterseiten
    pageTitle: '{title} · Xenios',
  },
  // Anmeldung (index.html, app.js)
  login: {
    prompt: 'Bitte mit dem App-Passwort anmelden.',
    password: 'Passwort',
    remember: 'Auf diesem Gerät angemeldet bleiben',
    submit: 'Anmelden',
    serverUnreachable: 'Server nicht erreichbar.',
  },
  // Verbindungspunkt oben rechts (Tooltip); noServer auch als Fehlermeldung der API
  conn: {
    noServer: 'Keine Verbindung zum Server',
    machineUnreachable: 'Maschine nicht erreichbar',
    connected: 'Verbunden',
  },
  // Seiten in der unteren Leiste und Titel der Kopfzeile
  nav: {
    home: 'Home',
    shots: 'Bezüge',
    scripts: 'Skripte',
    controls: 'Schalter',
    paddle: 'Paddle',
    timer: 'Timer',
    grinder: 'Mühle',
    settings: 'Einstellungen',
    settingsShort: 'Einstell.',
    shot: 'Bezug',
    scriptNew: 'Skript erstellen',
    scriptEdit: 'Skript bearbeiten',
    profileBuilder: 'Druckprofil erstellen',
    discover: 'Profile entdecken',
  },
  // Titel der Unterseiten der Einstellungen
  settingsPages: {
    appearance: 'Darstellung',
    view: 'Leiste & Ansicht',
    temperatures: 'Temperaturen & Druck',
    shots: 'Bezüge & Waage',
    power: 'Einschalten & Energiesparen',
    model: 'Modell, Aussehen & Firmware',
    firmware: 'Wi-Fi & Firmware',
    grinder: 'Mühle & Grind-by-Sync',
    remote: 'Von unterwegs',
    notifications: 'Benachrichtigungen',
    security: 'Sicherheit',
    system: 'System',
  },
  // Hinweis oben auf jeder Seite: eingestelltes Modell passt nicht zur Maschine
  modelHint: {
    bbs: 'Neue Xenia',
    classic: 'Alte Xenia (DBL)',
    switched: 'Auf „{model}“ umgestellt',
    switchTo: 'Auf „{model}“ umstellen',
    mismatch: 'Eingestellt ist „{configured}“, die Maschine antwortet aber wie die {detected}. Timer, Einstellungen und Schalter funktionieren so nicht richtig.',
    directHint: 'In der Einrichtung der App das Modell umstellen.',
  },
  // Ereignisse des Servers als Snackbar
  events: {
    message: '{title} – {body}',
    rate: 'Bewerten',
  },
  // Erster Start: Design wählen
  design: {
    title: 'Design wählen',
    intro: 'So sieht Xenios auf diesem Gerät aus. Später änderbar unter Einstellungen → Darstellung.',
    group: 'Design',
    materialTitle: 'Material',
    materialSub: 'Leiste unten mit Beschriftung, runde Formen, flache Anzeigen',
    xeniaTitle: 'Xenia',
    xeniaSub: 'Wie die Oberfläche der Maschine: Manometer, Navigation mit Symbolen',
  },
  // App-Shortcuts (Langdruck auf das App-Symbol), Snackbar
  shortcuts: {
    turningOn: 'Xenia wird eingeschaltet …',
    turningOnNoSteam: 'Xenia wird ohne Dampf eingeschaltet …',
    off: 'Xenia ausgeschaltet',
    eco: 'Eco-Modus aktiv',
    steamOn: 'Dampfkessel an',
  },
  // Android-App: Update-Hinweis und Notbetrieb ohne Server
  android: {
    updateAvailable: 'App-Update {version} verfügbar',
    updateView: 'Ansehen',
    fallback: 'Server nicht erreichbar – direkt mit der Maschine verbunden',
    fallbackServer: 'Server',
  },
  // Ersteinrichtung im Browser (setup.js)
  setup: {
    title: 'Xenios einrichten',
    // Schritte in der Fortschrittsanzeige
    steps: {
      code: 'Code',
      password: 'Passwort',
      machine: 'Xenia',
      grinder: 'Mühle',
      remote: 'Unterwegs',
      done: 'Fertig',
    },
    testConnection: 'Verbindung testen',
    testing: 'Teste …',
    copy: 'Kopieren',
    copied: 'Kopiert',
    showPassword: 'Passwort anzeigen',
    // Schritt 1: Einrichtungscode
    code: {
      label: 'Einrichtungscode',
      intro: 'Der Server ist noch nicht eingerichtet. Den Einrichtungscode zeigt das Server-Protokoll beim Start an.',
      hint: 'docker compose logs xenia\n# oder im Fenster von „npm start“',
    },
    // Schritt 2: App-Passwort
    password: {
      intro: 'Mit diesem Passwort melden sich alle Geräte an. Gespeichert wird nur ein scrypt-Hash.',
      label: 'App-Passwort (mind. 10 Zeichen)',
      repeat: 'Wiederholen',
      tooShort: 'Mindestens 10 Zeichen',
      mismatch: 'Passwörter stimmen nicht überein',
    },
    // Schritt 3: Maschine
    machine: {
      intro: 'Adresse der Espressomaschine im Heimnetz (steht im Router oder im Display der Xenia).',
      addressLocked: 'Adresse (per Umgebungsvariable festgelegt)',
      address: 'Adresse der Xenia',
    },
    // Schritt 4: Mühle
    grinder: {
      passwordLocked: 'per Umgebungsvariable gesetzt',
      ownerPassword: 'Owner-Passwort',
      address: 'Adresse der Mühle',
      passwordLabel: 'Owner-Passwort (wird verschlüsselt gespeichert)',
      enable: 'Mahlkönig E64 WS einbinden',
      enableSub: 'Rezepte, Mahlvorgänge, Meldungen',
      enableLabel: 'Mühle einbinden',
    },
    // Schritt 5: Von unterwegs (Cloudflare-Tunnel)
    tunnel: {
      test: 'Testen',
      takeToken: 'Token übernehmen',
      tokenTaken: 'Token übernommen. cloudflared startet.',
      command: 'Befehl aus Cloudflare',
      commandHint: 'Die Zeile einfügen. Xenios führt sie nicht aus, sondern startet cloudflared selbst.',
      publicUrl: 'Öffentliche Adresse',
      later: 'Noch nicht fertig? Einfach weiter. Eintragen und testen geht jederzeit unter Einstellungen → Von unterwegs.',
      intro: 'Optional: Xenios von unterwegs erreichen, über einen Cloudflare-Tunnel. Ohne Portfreigabe im Router und mit echtem Zertifikat; damit lässt sich die App auch installieren und Push nutzen.',
      title: 'Cloudflare-Tunnel',
      sub: 'Braucht ein Cloudflare-Konto und eine eigene Domain',
    },
    // Schritt 6: Zusammenfassung
    summary: {
      finish: 'Einrichtung abschließen',
      password: 'App-Passwort',
      machine: 'Xenia',
      machineValue: '{model} · {url}',
      classic: 'Alte Xenia',
      bbs: 'Neue Xenia',
      grinder: 'Mühle',
      grinderOff: 'nicht eingebunden',
      remote: 'Unterwegs',
      remoteLater: 'später einrichten',
      token: 'Tunnel-Token',
      tokenTaken: 'wird übernommen',
      timezone: 'Zeitzone',
      timezoneSystem: 'System',
      note: 'Alles lässt sich später unter Einstellungen ändern: Modell und Mühle unter Espressomaschine, Zugänge, Passwort, Funktionen und Zeitzone unter Server.',
    },
    // Ergebnis eines Verbindungstests
    probe: {
      useClassic: 'Die Maschine antwortet wie die alte API – oben „Alte Xenia“ wählen.',
      useBbs: 'Die Maschine antwortet wie die neue API – oben „Neue Xenia“ wählen.',
      fitsClassic: 'Passt zur alten Xenia-API',
      fitsBbs: 'Passt zur neuen Xenia-API',
      wrongPassword: 'Passwort falsch',
      loginOk: 'Anmeldung ok',
      certificate: 'Zertifikat {fingerprint}…',
    },
    // Auswahl des Modells (auch in den Einstellungen)
    model: {
      group: 'Xenia-Modell',
      bbs: 'Neue Xenia',
      classic: 'Alte Xenia',
      question: 'Welche Xenia?',
      help: 'Neue Xenia: Brew-by-Sync / aktuelle Firmware. Alte Xenia: DBL mit der älteren offiziellen API.',
    },
    // Anleitung für den Cloudflare-Tunnel; {…} sind Links, Hervorhebungen oder Namen aus der Cloudflare-Oberfläche
    guide: {
      account: 'Cloudflare-Konto und eine eigene Domain, die bei Cloudflare verwaltet wird.',
      create: 'Auf {link} unter {path} einen Tunnel „xenios“ anlegen.',
      createPath: 'Networks → Tunnels → Create a tunnel → Cloudflared',
      copyDocker: 'Bei „Install and run a connector“ die Zeile {cmd} kopieren. Den Befehl nicht ausführen.',
      installDirect: 'Bei „Install and run a connector“ das Betriebssystem dieses Rechners wählen und den angezeigten Befehl auf diesem Rechner ausführen. Er richtet cloudflared als Dienst ein.',
      pasteDocker: 'Die Zeile unten bei {field} einfügen und {button} wählen. Den Befehl nicht ausführen. Xenios schreibt den Token und startet cloudflared.',
      troubleIntro: 'Startet cloudflared nicht, auf dem Server den Ordner der Installation nehmen. Als root zeigt ~ auf /root. Beispiel:',
      troubleThen: 'Danach:',
      troubleResult: 'In der Ausgabe steht „Tunnel-Token übernommen, starte cloudflared.“ xenios ist healthy, cloudflared läuft.',
      route: 'Im Tunnel {route}: Subdomain und Domain wählen, als {service} genau das eintragen:',
      routePath: 'Add route → Published Application',
      serviceUrl: 'Service URL',
      publicUrl: 'Die öffentliche Adresse (z. B. https://xenios.example.de) eintragen und {test}.',
    },
  },
  // Bausteine der Oberfläche (ui.js): Regler, Zeitangaben, Dialoge, Auswahllisten
  ui: {
    enterValue: 'Wert eingeben',
    enterValueFor: '{label}: Wert eingeben',
    allowed: 'Erlaubt: {range}',
    justNow: 'gerade eben',
    minutesAgo: 'vor {n} min',
    hoursAgo: 'vor {n} h',
    time: 'Uhrzeit',
    none: 'Keine',
    choose: 'Auswählen',
  },
  // Fehlermeldungen der API (api.js, shared/routes.js)
  api: {
    error: 'Fehler {status}',
    invalidId: 'Ungültige ID',
    endpointBlocked: 'Dieser Endpunkt ist nicht freigegeben',
    noGrindLogs: 'Keine Mahl-Logs gefunden',
    databaseDisabled: 'Datenbank-Download ist deaktiviert (enthält WLAN-Passwort). In config.json grinder.allowDatabaseDownload = true setzen.',
    // Dateiname des CSV-Exports der Bezüge
    shotsCsvFile: 'Xenia-Bezuege-{date}.csv',
  },
  // Komponenten, die sich ausblenden lassen (Einstellungen → Leiste & Ansicht)
  components: {
    grinderTitle: 'Mühle',
    grinderSub: 'Mühlen-Tab, Mühlen-Kacheln, Mahlvorgänge auf der Startseite',
    scaleTitle: 'Waage',
    scaleSub: 'Gewicht und Bezugsgewichte der internen Waage',
    careTitle: 'Pflege (Backflush)',
    careSub: 'Backflush-Erinnerung und Pflege-Kachel',
  },
  // Direkt-Modus (ohne Server): Meldungen des Backends in der App (js/direct/backend.js)
  direct: {
    badAnswer: 'Ungültige Antwort der App',
    grinderCertChanged: 'Zertifikat der Mühle hat sich geändert – möglicher Angriff. In der App unter „Verbindung“ neu einrichten.',
    serverOnly: 'Nur mit Server verfügbar (Direkt-Modus)',
  },
};
