# Beheer, onderhoud en back-ups

Alle beheeronderdelen zijn inklapbaar. De bestaande beheersessie en controle op dezelfde herkomst blijven verplicht voor alle wijzigingen. Controleadressen en back-upbestanden zijn uitsluitend voor beheerders bereikbaar.

## Onderhoudsplanning

Kies een toekomstige begin- en eindtijd en een reden. De tijden van het formulier gebruiken de tijdzone van het apparaat; de server bewaart UTC-tijdstempels. De actieve achtergrondmonitor voert één geplande actie per ronde uit. Bij een verbindingsfout wordt de actie opnieuw geprobeerd; in het panel staat de fout. Een verlopen planning wordt niet alsnog gestart wanneer de hele onderhoudsperiode al voorbij is.

- **Statuswebsite** sluit de statuswebsite zelf. Het beheerpanel en de monitor blijven bereikbaar.
- **Overheidsportaal** bedient de bestaande beveiligde onderhoudsfunctie van de echte website.
- **Dienststatus** wijzigt alleen de onderhoudsweergave van de geselecteerde dienst. Dit schakelt MEOS, een bot of een andere externe website niet daadwerkelijk uit.

De eindtijd heft het geplande onderhoud automatisch op. Algemene storingsmeldingen blijven onafhankelijk actief. Nog niet begonnen planningen kunnen worden geannuleerd. Voor automatische uitvoering moet de bestaande Render-monitor blijven draaien; bij uitval wordt geen exacte uitvoeringstijd gegarandeerd.

## Storingsbevestiging

Een automatische `down`- of `degraded`-waarneming wordt pas bevestigd na drie opeenvolgende mislukte controles, minstens vijf seconden uit elkaar. Gelijktijdige bezoekers kunnen de teller niet sneller verhogen. Een geslaagde controle reset de teller. Na een meetpauze van meer dan dertig seconden begint de bevestiging opnieuw. De teller staat in PostgreSQL en blijft geldig bij wisselende serverprocessen.

Tot bevestiging toont de dienst een onzekere controle met de voortgang. Er wordt nog geen automatisch storingsincident geopend en geen Discord-storingsmelding verzonden. Beheeronderhoud, pauzeren en algemene storingsmeldingen gaan direct in. Onderhoudsredenen zijn direct zichtbaar in kaarten en in de naamkolom van de tabel.

## Logboek en Discord

Het logboek bewaart dienstwijzigingen, onderhoud, algemene meldingen, planningsacties en herstelacties. Omdat de website één gedeeld beheeraccount heeft, is de uitvoerder **beheerder**. Automatische acties zijn gemarkeerd als **achtergrondmonitor**. Dit identificeert geen afzonderlijke personen.

Nieuwe logregels worden met `DISCORD_WEBHOOK_URL` doorgestuurd, zonder credentials of controleadressen. Bij een niet-bevestigde webhookbezorging probeert de achtergrondmonitor het na minstens één minuut opnieuw. Het interne logboek blijft ook bij Discord-uitval beschikbaar. Een timeout na ontvangst door Discord kan tot een dubbele bezorging leiden.

## Dienstenback-ups

De monitor maakt dagelijks een back-up van de diensteninstellingen. Vóór toevoegen, aanpassen en verwijderen van diensten wordt eveneens een back-up gemaakt. Handmatig maken, downloaden, importeren en herstellen kan in het panel. Download een kopie om ook bij database-uitval een extern herstelbestand te hebben.

Herstel valideert alle diensten en voert de toevoegingen en wijzigingen atomair uit. Vóór herstel wordt de huidige situatie geback-upt. Later toegevoegde diensten en bestaande meetgeschiedenis worden niet verwijderd. De daadwerkelijke onderhoudstoegang van het overheidsportaal, de statuswebsite, authenticatiegeheimen en Discord-sleutels worden niet uit een dienstenback-up hersteld.

De meetgeschiedenis blijft één meetpunt per minuut en wordt na 24 uur opgeruimd. Deze korte bewaartermijn geldt niet voor het beheerlogboek, planningen en dienstenback-ups.
