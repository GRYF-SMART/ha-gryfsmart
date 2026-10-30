# GRYFSMART dla Home Assistanta

Lokalna integracja przez **Ethernet (ETH0606T)** albo **RS-232 / adapter USB–RS232**. Bez MQTT, chmury i stale uruchomionego programu Windows. Po dodaniu połączenia integracja rozpoznaje moduły i sama tworzy urządzenia oraz encje.

## Instalacja przez HACS

Adres do wklejenia jako repozytorium niestandardowe:

```text
https://github.com/GRYF-SMART/ha-gryfsmart
```

1. Otwórz **HACS → menu ⋮ → Repozytoria niestandardowe**.
2. Wklej adres powyżej i wybierz kategorię **Integracja**.
3. Wyszukaj **GRYFSMART**, pobierz integrację i uruchom ponownie Home Assistanta.
4. Wybierz **Ustawienia → Urządzenia i usługi → Dodaj integrację → GRYFSMART**.
5. Wybierz **Ethernet** lub **RS-232**. Podaj IP ETH i port **5000**, albo port adaptera szeregowego widoczny w HA.

Integracja jest repozytorium niestandardowym HACS, nie wbudowaną integracją HA. Wymagany Home Assistant 2025.6 lub nowszy. Pobranie kodu z GitHub samo w sobie nie dodaje integracji do Twojej instancji HA — wykonaj powyższe kroki.

### Ethernet

ETH musi mieć firmware **25 lub nowszy**, poprawny adres IP i połączenie z linią modułów. Wpisz faktyczny adres ETH; `192.168.1.200` jest jedynie domyślnym adresem fabrycznym. Port aplikacji to TCP **5000**, nie port bootloadera 5001. Firmware nie wymaga zmiany bootloadera do zwykłego sterowania z HA.

ETH obsługuje jednego klienta TCP sterującego. Rozłącz GRYFEXPERT oraz inne programy używające tego samego połączenia przed dodaniem ETH do HA. Moduł ETH ma ID **1**, a kolejne moduły muszą mieć różne ID **2–35**.

### RS-232

Podłącz adapter USB–RS232 do maszyny, na której działa HA. Wybierz np. `/dev/ttyUSB0`, a najlepiej trwałą ścieżkę `/dev/serial/by-id/...`, którą można wpisać ręcznie. Parametry są ustawiane automatycznie: **115200, 8N1**, bez kontroli przepływu, DTR/RTS wyłączone. ETH nie jest wymagany przy bezpośrednim połączeniu szeregowym z linią.

W HA uruchomionym w VM lub kontenerze przekaż adapter do VM/kontenera. Nie wybieraj portu zajętego przez Herculesa ani programator. Użyj właściwego interfejsu elektrycznego modułu; RS-232 i TTL nie są zamienne. Skan CHAIN1 prowadzi od portu logicznego **0 do 1** następnego modułu.

## Automatycznie tworzone encje

| Moduł | Encje |
|---|---|
| ETH0606T | 6 wejść, 6 przełączników, 5 kanałów temperatury, zdarzenia wejść |
| R0808 | 8 wejść, 8 przełączników, 2 temperatury, 2 termostaty, zdarzenia wejść |
| R0806T | 8 wejść, 6 przełączników, 2 temperatury, 2 termostaty, zdarzenia wejść |
| S0804 | 8 wejść, 4 rolety z otwieraniem/zamykaniem/STOP/pozycją, zdarzenia wejść |
| R0806T-OLD | 8 wejść, 6 przełączników, zdarzenia wejść; brak temperatur i termostatów |

Każdy moduł ma też encję wersji firmware. Kanały temperatur bez czujnika lub bez świeżej próbki są **niedostępne**, a nie równe 0°C. Nieznana pozycja rolety pozostaje nieznana; nie jest zgadywana. Po restarcie S0804 pozycję ustala pełny przejazd przy poprawnie ustawionych czasach.

Wymagany komplet: **ETH0606T ≥25, R0808 ≥25, R0806T ≥27, S0804 ≥27, OLD ≥4**. [Firmware i narzędzia aktualizacji](https://github.com/GRYF-SMART/gryfsmart-firmware/releases/latest). Numery wersji modeli są niezależne.

Skan odczytuje identyfikację CHAIN1, **nie nadaje i nie zmienia ID**. Przy pierwszym braku odpowiedzi kończy się po 2 s; moduły za przerwą w linii nie będą dodane. Powielone ID blokują dodanie sieci, aby nie sterować niewłaściwym urządzeniem. Dodane później moduły wykryj przyciskiem **Wykryj moduły ponownie**. Nazwy i obszary encji można zmieniać w HA; pozostają zachowane przy restarcie i ponownym skanie, jeśli ID i model się nie zmienią.

## Zdarzenia wejść i automatyzacje

Każde wejście ma czujnik binarny oraz encję `event` z czterema typami:

| `event_type` | Znaczenie |
|---|---|
| `closed` | Moment zwarcia: stan wejścia zmienił się z 0 na 1 |
| `opened` | Moment rozwarcia: stan wejścia zmienił się z 1 na 0 |
| `short_press` | Krótkie naciśnięcie, raport PS |
| `long_press` | Długie naciśnięcie, raport PL |

W czujniku binarnym **on = zwarcie**, **off = rozwarcie**. Pierwszy odczyt po połączeniu tylko ustala stan początkowy i nie generuje zwarcia/rozwarcia. Kolejne zmiany raportowane przez moduł generują zdarzenia. Nie ma gwarancji odtworzenia impulsów podczas zerwanego połączenia; ponowny odczyt nie jest historycznym rejestrem zdarzeń.

W automatyzacji wybierz zmianę stanu encji zdarzeniowej wejścia i warunek jej atrybutu `event_type`. To pozwala obsłużyć kolejne identyczne krótkie naciśnięcia. Pomijaj stan początkowy `unknown`/`unavailable`; same zmiany dostępności nie są naciśnięciem.

## Termostaty

W R0808 i R0806T powstają po **dwie encje climate**. Obsługują temperaturę bieżącą, nastawę co 0,1°C, tryby **wyłączony / grzanie / chłodzenie** i stan działania sprzętowego regulatora.

Źródło temperatury, histerezę i przypisane przekaźniki ustaw najpierw w GRYFEXPERT. Integracja odczytuje te ustawienia przed każdą zmianą i zachowuje je. Pusty kanał termostatu pojawi się w HA, ale nie można włączyć go bez przypisanych wyjść. Nastawy są sprawdzane odczytem zwrotnym. HA nie zastępuje lokalnego regulatora: moduł wykonuje regulację niezależnie od połączenia z HA.

Zmiany z HA dotyczą RAM. Jeśli mają przetrwać restart modułu, naciśnij **Zapisz konfigurację w module**. Nie zapisujemy EEPROM przy każdym przesunięciu suwaka temperatury. Zapis obejmuje bieżącą konfigurację całego modułu, także inne niezapisane ustawienia.

W OLD nie ma lokalnego API odczytu stanów: przełączniki i wejścia początkowo mają stan nieznany, aż nadejdzie raport `o=`/`I=`. Potwierdzenie `RuleOK` nie jest używane do udawania odczytu przekaźnika. Termostatów i PWM OLD nie tworzymy. Lokalny PWM pełnego R0806T nie jest jeszcze wystawiony w tej wersji integracji.

## Instalacja ręczna

Pobierz paczkę `GRYFSMART-HomeAssistant-0.1.0.zip` z [wydań](https://github.com/GRYF-SMART/ha-gryfsmart/releases/latest). Skopiuj jej katalog `custom_components/gryfsmart` do `/config/custom_components/gryfsmart` w HA, uruchom HA ponownie i dodaj integrację z interfejsu. Nie dodawaj dodatkowego zagnieżdżenia katalogów. Usuwanie: usuń wpis integracji w Urządzeniach i usługach, następnie integrację w HACS.

## Testy

Testy obejmują ramki CR/LF, CRC CHAIN1, wykrywanie pięciu modeli, koniec skanu po 2 s, powielone ID, komendy przekaźników i rolet, temperatury ujemne, cztery rodzaje zdarzeń, zachowanie konfiguracji termostatów oraz brak ponawiania zapisów po timeout. Połączenie szeregowe jest testowane przez transport asynchroniczny i wirtualny port; testy nie programują urządzeń. Osobny test uruchamia integrację i usługi encji w Home Assistant na Linux.

Walidacja programowa nie zastępuje sprawdzenia rzeczywistego okablowania i modułów w instalacji.

## PWM — wersja 0.2.0

R0806T automatycznie otrzymuje encję `number` o nazwie PWM: suwak 0–100%, krok 1%. Zero wyłącza wyjście; większa wartość ustawia wypełnienie. Stan pochodzi z odczytu sprzętu i raportów po zmianie, także zmianie z reguły lub GRYFEXPERT. Atrybuty: cel, ostatni niezerowy poziom, aktywna rampa i częstotliwość. ETH, R0808, S0804 i OLD nie otrzymują tej encji, bo nie mają lokalnego PWM.

Protokół: `AT+PWM=3,4,50,57` ustawia 50% w module ID 3. Potwierdzenie `RuleOK=3`, następnie `AT+GetPWM=3` i raport `PWM=3,50,50,50,0,2000`. Bez nowego firmware, bez zapisu EEPROM przy ruchu suwaka. Dotychczasowa minimalna wersja R0806T 27 obsługuje te komendy. Działa przez Ethernet (HA port 5000) i RS-232.

Po aktualizacji integracji uruchom HA ponownie. Nowa encja pojawi się po załadowaniu integracji, bez ponownego dodawania instalacji. ETH firmware 27 umożliwia równoległe połączenie GRYFEXPERT na porcie 5002.
