Übung 6: Fahrzeuge
Thema: Vererbung, abstrakte Klassen, Überschreiben, Polymorphie

Fahrzeug ist eine abstrakte Klasse: Es gibt nur Autos und Fahrräder.

1. Schau dir an, wie Auto und Fahrrad mit super(name) den Konstruktor von
   Fahrzeug aufrufen. Im Klassendiagramm zeigen die Pfeile zu Fahrzeug.
2. getRaeder() liefert noch 0. Ein Auto hat 4 Räder, ein Fahrrad 2.
3. beschreibung() in Fahrzeug liefert zum Beispiel "Golf hat 4 Räder".
   Sie benutzt getRaeder() – und bekommt für jedes Fahrzeug die richtige Zahl.
   Das nennt man Polymorphie.

Dann die Tests in FahrzeugTest.
