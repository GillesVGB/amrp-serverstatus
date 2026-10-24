# Overheidsportaal vanuit statusbeheer bedienen

Het beheerpanel bevat **Overheidsportaal bedienen**. Dit bedient de echte onderhoudsfunctie van overheid.amsterdamrp.nl. Normale gebruikers worden geblokkeerd; overheidsbeheerders behouden hun bestaande beheerroute.

Configureer een aparte willekeurige sleutel van minstens 32 tekens, uitsluitend server-side:

- Statuswebsite: `OVERHEID_STATUS_CONTROL_SECRET`
- Overheidsportaal: `STATUS_CONTROL_SECRET`

Gebruik dezelfde waarde op beide servers. Deel de sleutel niet met browsers en commit hem niet. Deze koppeling gebruikt een vast HTTPS-adres; adressen uit dienstenrecords worden nooit met deze sleutel aangeroepen.

De statuswebsite vereist een geldige beheersessie en dezelfde origin voor wijzigingen. Het overheidsportaal controleert de aparte sleutel en schrijft iedere wijziging in zijn auditlog. De bestaande overheidslogin en onderhoudsfunctie blijven werken. De actuele toestand wordt bij het openen van het panel opgehaald en kan opnieuw worden ververst. Bij verbindingsverlies wordt geen geslaagde wijziging getoond.

Een geslaagde wijziging synchroniseert de handmatige onderhoudsstatus van de bijbehorende overheidsdienst. Algemene storingsmeldingen blijven onafhankelijk actief en kunnen na heropening nog rood aangeven. Andere diensten en het onderhoud van de statuswebsite veranderen niet. MEOS is nog niet gekoppeld.
