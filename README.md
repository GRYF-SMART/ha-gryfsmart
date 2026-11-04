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

Protokół: `AT+PWM=3,4,50,15,72` ustawia 50% w module ID 3. Potwierdzenie `RuleOK=3`, następnie `AT+GetPWM=3` i raport `PWM=3,50,50,50,0,2000`. Bez nowego firmware, bez zapisu EEPROM przy ruchu suwaka. Dotychczasowa minimalna wersja R0806T 27 obsługuje te komendy. Działa przez Ethernet (HA port 5000) i RS-232.

Po aktualizacji integracji uruchom HA ponownie. Nowa encja pojawi się po załadowaniu integracji, bez ponownego dodawania instalacji. ETH firmware 27 umożliwia równoległe połączenie GRYFEXPERT na porcie 5002.

## PWM — wersja 0.2.1

Każda zmiana suwakiem wysyła rampę 1,5 s (15 jednostek po 0,1 s), również przejście do 0%. Rampę wykonuje sprzętowy firmware modułu, bez wysyłania serii małych kroków z HA. Nowe ustawienie podczas rampy przechodzi od aktualnego poziomu do nowego celu. Stan encji pozostaje odczytem rzeczywistym; zakończenie rampy aktualizuje raport PWM. Nie potrzeba nowego HEX-u.

## PWM — wersja 0.2.2

Podczas rampy integracja odczytuje rzeczywisty poziom przez `AT+GetPWM` co około 150 ms i publikuje kolejne wartości encji. Suwak oraz procent mogą pokazywać postęp w trakcie 1,5 s zamiast przeskakiwać dopiero po zakończeniu. Nie jest to animacja wyliczona w HA: stan pochodzi z modułu. Odczyty kończą się po rampie, rozłączeniu albo po limicie 8 s; jedna rampa wysyła tylko jedno polecenie sterujące. Ruch suwakiem w interfejsie może zależeć od użytej karty i opóźnienia sieci.

## Panel reguł — wersja 0.3.0

Po aktualizacji HACS i pełnym restarcie Home Assistant administrator zobaczy w bocznym menu **GRYFSMART — Konfiguracja**. Jeśli panel nie pojawi się od razu, odśwież aplikację lub stronę HA. Panel działa także na telefonie, bez dopisywania YAML i bez nowego firmware.

1. Wybierz instalację, moduł i regułę 1–16.
2. Naciśnij **Odczytaj regułę**. Odczyt obejmuje wejścia, akcje, cztery sloty oraz istniejące PWM i wyzwalacze temperatury.
3. Zmień zdarzenia (krótkie/długie naciśnięcie, zwarcie/rozwarcie) oraz akcje lokalne albo zdalne. Dostępne są przekaźniki, rolety i pozycje, PWM z rampą, impulsy czasowe oraz wyzwalanie temperaturą w obsługiwanych modelach.
4. Naciśnij **Wyślij i zapisz w module** i potwierdź. Reguła najpierw jest wyłączana, zmieniana i porównywana z odczytem sprzętu. Dopiero potem ustawiany jest docelowy stan włączenia i zapisywane EEPROM. Reguły działają w module także bez HA.

Panel odrzuca edycję starego odczytu (10 minut, zmiana użytkownika/instalacji lub zmiana reguły w sprzęcie). Po błędzie nie ponawia automatycznie poleceń zapisujących. Ponownie odczytaj regułę, zanim ponowisz zapis. Zapis EEPROM utrwala bieżącą konfigurację całego wybranego modułu, w tym inne wcześniejsze niezapisane zmiany. Edytor wysyła wyłącznie wybraną regułę; pozostałe reguły pozostają zachowane. Nie edytuj równolegle tej samej instalacji z GRYFEXPERT.

**OLD** jest widoczny, ale nie jest edytowany w tym panelu, ponieważ jego firmware nie udostępnia odczytu konfiguracji potrzebnego do kontroli zmian. Do OLD użyj GRYFEXPERT. **ETH0606T, R0808, R0806T i S0804** obsługują edytor.

Panel i jego API wymagają administratora HA. Odczyty są uwierzytelnione przez istniejącą sesję Home Assistant; nie tworzą nowego publicznego portu. Edytor nie zmienia adresów ID ani konfiguracji sieciowej.

## 0.3.1 — nazwy z EEPROM
Po uruchomieniu/przeładowaniu integracji i po ponownym połączeniu HA odczytuje nazwy z modułów przed utworzeniem encji. Nie trzeba logować się ponownie do interfejsu HA. Nazwy modułu, wejść, wyjść/rolet, regulatorów, czujników R0806T/R0808 oraz PWM są odczytywane przez NameGet. Wymagane firmware ETH/R0808/R0806T 29, S0804 30, OLD 6. Czujniki ETH zachowują dotychczasowe etykiety — firmware ETH nie udostępnia dla nich pól nazw EEPROM.
Starszy firmware, puste nazwy lub błąd odczytu zachowują nazwy domyślne/ostatnie; problem nazwy nie blokuje sterowania. Nazwy użytkownika ustawione w rejestrze encji/urządzeń HA mają pierwszeństwo. Identyfikatory unique_id nie zmieniają się. Integracja wyłącznie odczytuje nazwy: nie wysyła NameSet ani SaveConfig. Nazwy nadaj w GRYFEXPERT 0.5.20 → Informacje → Nazwy zapisane w module. Po zmianie nazw przeładuj integrację HA.
Aktualizacja: HACS → GRYFSMART → pobierz 0.3.1, następnie uruchom ponownie cały Home Assistant.

## PWM: przełączanie na zadaną wartość (0.3.2)

W panelu konfiguracji reguł PWM są dwie osobne akcje:
- „Przełącz — pamięta ostatni poziom” zachowuje dotychczasowe działanie.
- „Przełącz — 0% ↔ wartość zadana” pozwala ustawić procent i rampę w regule lokalnej lub slocie zdalnym.

Nowa akcja wymaga firmware R0806T 31, R0808 31, ETH0606T 32, S0804 32 lub OLD 9 odpowiednio na celu, źródle reguły i drodze transmisji. OLD steruje PWM zdalnie, nie ma lokalnego PWM. Najpierw zaktualizuj moduły. Dotychczasowe akcje są zgodne ze starszym firmware.
Po aktualizacji integracji przez HACS uruchom ponownie HA. Nie trzeba usuwać integracji ani ponownie dodawać urządzeń.

## Karta całej instalacji (0.3.4)

Opcjonalna karta Lovelace „GRYFSMART — cała instalacja” zbiera wszystkie widoczne, włączone encje ze wszystkich hubów i modułów: wyjścia, rolety, PWM, wejścia, zdarzenia wejść, temperatury, termostaty, firmware i przyciski serwisowe. Urządzenia i encje nadal pozostają osobno na swoich stronach HA. Niedostępne moduły pozostają widoczne. Karta respektuje uprawnienia użytkownika oraz ukrycie/wyłączenie encji w HA.

Aktualizuj integrację w HACS do **0.3.4**, uruchom ponownie Home Assistanta i odśwież przeglądarkę (Ctrl+F5). Otwórz **Przegląd → Edytuj pulpit → + w sekcji → Według karty**, wyszukaj „GRYFSMART — cała instalacja”, wybierz ją i zapisz. Nie usuwaj integracji ani urządzeń. Karta działa także w widoku Panel (pojedyncza karta). Jeżeli chcesz, możesz użyć edytora YAML:

```yaml
type: custom:gryfsmart-system-card
```

Zasób JavaScript jest rejestrowany automatycznie przez integrację. Nie trzeba osobnego repozytorium karty w HACS. Wersja 0.3.4 poprawia błędny typ w selektorze i odrzucanie standardowej konfiguracji z 0.3.3. Dopuszcza ponowną edycję, zachowuje suwaki podczas zmian stanów i rozróżnia moduły o identycznych nazwach.

Stany są aktualizowane przez HA na bieżąco, a lista modułów i etykiety odświeżają się co 30 s bez odpytywania sprzętu. „Odśwież listę” pobiera tę listę od razu. Administrator może kliknąć **„Odczytaj nazwy z modułów”**, aby odczytać aktualne etykiety z EEPROM bez restartowania HA. Nazwy są również odczytywane po uruchomieniu/przeładowaniu integracji i po ponownym połączeniu. Ręczne nazwy w HA mają pierwszeństwo; identyfikatory encji i automatyzacje pozostają zachowane. Częściowy odczyt pokazuje ostrzeżenie i zachowuje wcześniejsze nazwy.

Od 0.3.7 nazwy z projektu można importować w panelu „GRYFSMART — Konfiguracja”. Można również zapisać nazwy w EEPROM z zakładek Wejścia, Wyjścia i Termostaty w GRYFEXPERT 0.5.33, a potem odczytać je z karty. Firmware bez obsługi nazw udostępnia etykiety domyślne. Ta aktualizacja karty nie wymaga nowych HEX-ów.

## Osobne kafelki na panelu (0.3.5)

Administrator może kliknąć **„Dodaj osobne kafelki”** na karcie GRYFSMART. Wybierz panel i istniejącą zakładkę z układem **Sekcje** lub nową zakładkę „GRYFSMART — kafelki”. Podgląd pokazuje liczbę kafelków w każdym module. Dopiero **„Dodaj kafelki”** zapisuje układ. Najpierw zakończ zwykłą edycję panelu przyciskiem „Gotowe”.

Każde wyjście, wejście, PWM, czujnik temperatury, termostat, roleta, zdarzenie i encja serwisowa otrzymuje niezależną, standardową kartę `tile` HA. Jeden moduł tworzy jedną sekcję; kafelki można swobodnie przesuwać i edytować w HA. PWM ma suwak, przekaźniki przełącznik, rolety przyciski ruchu, a termostaty regulację temperatury. Przyciski serwisowe otwierają szczegóły encji, zamiast wykonywać operację po przypadkowym kliknięciu ikony.

Istniejący układ i karta zbiorcza pozostają zachowane. Encje już wyświetlane w docelowej zakładce są pomijane. Kolejne uruchomienie może dodać nowe encje, ale nie synchronizuje automatycznie rozmieszczenia kart. Nazwy kafelków nie są utrwalane w konfiguracji — po odczytaniu nazw z modułów korzystają z bieżących nazw HA, z pierwszeństwem ręcznych nazw użytkownika. Nagłówki sekcji otrzymują nazwy modułów z momentu dodania i można je edytować.

Generator korzysta ze standardowych [kafelków HA](https://www.home-assistant.io/dashboards/tile/) i [sekcji](https://www.home-assistant.io/dashboards/sections/). Obsługuje panele edytowane w interfejsie, z własną konfiguracją, bez automatycznych strategii. Bezpośrednio przed zapisem sprawdza, czy układ nie zmienił się od podglądu; po zapisie odczytuje go kontrolnie. HA nie oferuje atomowej blokady edycji z innych kart przeglądarki, więc na czas dodawania zakończ równoległą edycję tego panelu. Przy utracie potwierdzenia przycisk „Sprawdź stan panelu” wykonuje tylko odczyt; zapis nie jest ponawiany automatycznie.

Aktualizacja: HACS → GRYFSMART **0.3.5**, restart HA, Ctrl+F5. Jeśli kartę dodano ręcznie w zasobach, zaktualizuj jej adres do `/gryfsmart-system/system-card.js?v=0.3.5` (typ: Moduł JavaScript). Ta funkcja nie wymaga aktualizacji firmware ani GRYFEXPERT.

## Regulator temperatury i nazwy (0.3.7)

Karta **Regulator temperatury** (`type: custom:gryfsmart-thermostat-card`) pozwala wybrać encję `climate` regulatora. Korzysta z aktualnej nazwy encji; własny tytuł można podać w edytorze. Kolory: śliwkowy, fioletowy i różowy. Wskaźnik pokazuje raportowany stan wyjść regulatora.

- **OFF**: wyłącza przypisane wyjścia.
- **ON**: wymusza załączenie niezależnie od temperatury i czujnika; wymaga firmware 32 R0806T/R0808, także w modułach przekazujących komendę.
- **AUTO**: regulacja według temperatury i histerezy (grzanie lub chłodzenie).
- **ECO**: zmiana temperatury zadanej i przejście do AUTO. Powrót do AUTO z karty odtwarza temperaturę komfortową zapamiętaną w tej przeglądarce.

W standardowych kartach i automatyzacjach użyj `climate.set_preset_mode` z `preset_mode: off`, `on` lub `auto`. `climate.turn_on` oznacza teraz wymuszone ON; do regulacji używaj preset `auto` albo dotychczasowych trybów HVAC `heat`/`cool`. Na starszym firmware ON jest niedostępne, AUTO i OFF działają. Nastawy HA działają w RAM; przycisk zapisu konfiguracji modułu utrwala je w EEPROM.

**GRYFSMART — Konfiguracja → Nazwy z projektu i nazwy regulatorów**: wybierz instalację i plik `.gryf.json`, potem **Importuj nazwy z projektu**. Import sprawdza ID i model, zapisuje tylko nazwy w HA, nie steruje sprzętem. Można też zmienić nazwę pojedynczego regulatora. Nazwy przetrwają restart i mają pierwszeństwo przed EEPROM. Ręczne nazwy w ustawieniach encji HA pozostają nadrzędne. Identyfikatory encji i automatyzacje nie zmieniają się.

Aktualizacja: HACS → GRYFSMART 0.3.7 → restart HA → Ctrl+F5. Karta regulatora rejestruje się automatycznie. Ręczny wpis zasobu: `/gryfsmart-system/thermostat-card.js?v=0.3.7`, typ Moduł JavaScript.

## 0.3.8 — karty Drzwi i Brama

Po aktualizacji integracji zrestartuj Home Assistant i odśwież przeglądarkę.
W panelu wybierz Dodaj kartę → GRYFSMART — Drzwi lub GRYFSMART — Brama.
Karty rejestrują się automatycznie. Gdy przeglądarka nie wczyta zasobu,
dodaj jako moduł JavaScript `/gryfsmart-system/door-card.js?v=0.3.8`
lub `/gryfsmart-system/gate-card.js?v=0.3.8` w zasobach panelu.

Drzwi: wybierz osobno moduł/wyjście elektrozaczepu oraz moduł/wejście
kontaktronu. ON wyjścia oznacza zamkniętą kłódkę, OFF otwartą.
Dla kontaktronu wybierz, czy drzwi zamknięte oznaczają wejście zwarte (ON)
czy rozwarte (OFF). Stany niedostępne są pokazywane jako nieznane.

```yaml
type: custom:gryfsmart-door-card
title: Drzwi
output_entity: switch.twoje_wyjscie
contact_entity: binary_sensor.twoje_wejscie
closed_state: "on"
```

Brama: wybierz moduł i wyjście przekaźnikowe oraz czas impulsu 0,1–60 s,
z krokiem 0,1 s. Wyjście jest zamykane na ten czas, po czym moduł je otwiera.
Wykorzystywana jest akcja `gryfsmart.pulse` i sprzętowa komenda `AT+Pulse`.
Impuls nie jest ponawiany po utracie potwierdzenia. Przeglądarka i HA nie
odmierzają czasu wyłączenia przekaźnika. Przycisk jest blokowany podczas
wysyłki, impulsu i gdy wyjście jest aktywne lub niedostępne. Położenie
bramy nie jest wywnioskowywane ze stanu przekaźnika.
Wymagany firmware obsługujący AT+Pulse (aktualne wsady GRYFSMART).

```yaml
type: custom:gryfsmart-gate-card
title: Brama wjazdowa
output_entity: switch.twoje_wyjscie
duration: 0.5
```

Zastąp przykładowe identyfikatory rzeczywistymi encjami albo użyj edytora wizualnego.

## 0.3.9 — karta Pomieszczenie

Dodaj kartę **GRYFSMART — Pomieszczenie**. Wybierz jedną z 12 ikon
(Salon, Kuchnia, Łazienka, Sypialnia, Pokój dzienny, Ogród, Gabinet,
Pokój dziecięcy, Garaż, Przedpokój, Jadalnia, Taras), wpisz nazwę pokoju
i użyj „Dodaj przycisk”. Każdy przycisk ma własną nazwę, moduł i wyjście.
Pusta nazwa oznacza aktualną nazwę encji HA. Przyciski można usuwać.
Kliknięcie przełącza wyjście; podświetlenie pojawia się dopiero zgodnie
ze stanem raportowanym przez moduł. Wyjścia niedostępne są szare i zablokowane.
Możesz dodać osobną kartę dla każdego pokoju, także z wyjściami różnych modułów.

```yaml
type: custom:gryfsmart-room-card
title: Salon
icon: salon
buttons:
  - entity: switch.twoja_lampa
    name: Lampa główna
  - entity: switch.twoj_kinkiet
    name: Kinkiet
```

Po aktualizacji do 0.3.9 zrestartuj HA i odśwież stronę.
Zasób awaryjny (Moduł JavaScript): `/gryfsmart-system/room-card.js?v=0.3.9`.


## Karta „GRYFSMART — dom i pomieszczenia” (0.3.10)

1. W GRYFEXPERT przypisz grupy wejściom, wyjściom/roletom, PWM i regulatorom. Zapisz projekt JSON.
2. Po aktualizacji integracji w HACS uruchom ponownie HA i odśwież aplikację/przeglądarkę.
3. Otwórz **GRYFSMART — Konfiguracja**, wybierz instalację i **Importuj nazwy i grupy z projektu**. Import zapisuje metadane w HA, bez sterowania sprzętem.
4. W panelu wybierz **Dodaj kartę → GRYFSMART — dom i pomieszczenia**. W edytorze wybierz wyjście elektrozaczepu i wejście kontaktronu (opcjonalne) oraz stan oznaczający zamknięte skrzydło.

```yaml
type: custom:gryfsmart-home-card
title: Mój dom
show_summary: true
# Opcjonalnie wybierz w edytorze:
# entry: ID_wpisu_integracji
# door_output: switch.elektrozaczep
# door_contact: binary_sensor.kontaktron
contact_closed_state: "on"
# groups: [standard-1, standard-2]
# exclude_entities: [switch.pompa]
```

Zakładki tworzą się wyłącznie z przypisanych elementów. Grupy różnych instalacji pozostają oddzielne nawet przy identycznym ID. Pokazują wyjścia, rolety, PWM, regulatory i przypisane wejścia. Czujniki bez grup nie są dodawane automatycznie; bieżąca temperatura regulatora pozostaje widoczna przy regulatorze. Nazwy użytkownika nadane ręcznie w HA mają pierwszeństwo przed importem.

Podsumowanie dotyczy elementów widocznych po filtrach: włączone przekaźniki oraz PWM >0%, rolety całkowicie otwarte/zamknięte, częściowo otwarte/w ruchu i brak danych. Każde wyjście przekaźnikowe jest traktowane jako obwód oświetlenia — pompy, wentylatory itp. wyklucz w edytorze. Wybrane wyjście zamka jest wykluczane automatycznie. Zamek: wyjście ON = kłódka zamknięta, OFF = otwarta. Kontaktron niezależnie pokazuje stan skrzydła.

Przyciski zbiorcze działają tylko w aktywnej grupie i są ukryte, jeśli grupa nie zawiera odpowiednich elementów. Wyłączenie oświetlenia ustawia przekaźniki OFF i PWM 0%; nie zmienia termostatów. Polecenia są wysyłane kolejno, niedostępne encje pomijane, a błąd zatrzymuje serię. Zmiana wyglądu przycisku następuje po otrzymaniu stanu HA, nie po samym kliknięciu. Grupy odświeżają się co 30 s lub przyciskiem ↻. Istniejące karty i pojedyncze encje pozostają dostępne.

Jeśli karta nie pojawi się po restarcie, sprawdź zasób typu **Moduł JavaScript**: `/gryfsmart-system/home-card.js?v=0.3.10` (integracja rejestruje go automatycznie).
