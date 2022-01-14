const { start, dispatch, stop, spawnStateless, spawn } = require('nact');
const system = start();

const fs = require('fs');
const crypto = require('crypto');

// Įvesties ir išvesties failų pavadinimai:
const fileName = "IFF-8-2_SimoliunasN_L1_dat_1.json";
const outputFileName = "IFF-8-2_SimoliunasN_rez.txt";

// Naudojamų darbininkų aktorių kiekis:
const n = 3;

// Funkcija, kuri randa objekto SHA256 kodą:
function hash(el) {

	// Sukuriama simbolių eilutė, naudojama SHA256 kodo skaičiavime:
	const data = el.code + "." + el.price + "." + el.count;

	const hash = crypto.createHash('sha256').update(data).digest('hex');
	return hash;
}

// Funkcija tikrina, ar objekto SHA256 kodo paskutinis simbolis yra raidė:
function filter(el) {
	const sha = hash(el);
	el["hash"] = sha;
	const last = sha.charAt(sha.length - 1);
	return last >= 'a' && last <= 'f';
}

// Funkcija grąžina darbininko aktorių su nurodytų pavadinimu
function getWorker(i) {
	const worker = spawnStateless(
		system,
		(msg, ctx) => {
			const filtered = filter(msg.el);

			// Tikrina, ar objektas atitinka filtravimo sąlygą,
			// arba ar objekto laukas "count" yra -1, kas bus naudojama
			// programos pabaigai nustatyti:
			if (filtered || msg.el["count"] == -1) {
				dispatch(distributor, { el: msg.el, sender: "worker" });
			}
		},
		// Paduodamas darbininko indeksas, pavadinimui jis paverčiamas į string:
		i.toString()
	);
	return worker;
}

// data - duomenys, perskaityti iš failo
// obj - iš JSON formato nuskaitytų objektų masyvas
const data = fs.readFileSync(fileName);
const obj = JSON.parse(data)["products"];

// Sukuriamas darbininkų masyvas:
const keys = [...Array(n).keys()];
const workers = keys.map(i => getWorker(i));

// Skirstytuvo aktorius:
const distributor = spawn(
	system,
	(state = {
		// Saugomas darbininko indeksas, kurį reikės naudoti kitą
		current: 0
	}, msg, ctx) => {

		// Boolean reikšmės, kad nuspręsti, koks aktorius iškvietė skirstytuvą:
		const senderMain = msg.sender == "main";
		const senderWorker = msg.sender == "worker";
		const senderLast = msg.sender == "last";

		if (senderWorker) {
			// Reikia siųsti rezultatų aktoriui, jei 
			// darbininko žinutėje yra nurodytas objektas:
			if (msg.el != undefined) {
				dispatch(res, { el: msg.el });
			}
		} 
		else if (senderMain) {
			// Vykdomas kodo blokas, kai gaunamas 
			// objektas iš pagrindinio scenarijaus:

			// Gaunamas darbininkas, kuriam bus siunčiamas objektas:
			const index = state.current;
			const worker = workers[index];

			// Gaunamas sekančio darbininko indeksas, masyvo pabaigoje grįžta į pradžią:
			const newCurrent = state.current == n - 1 ? 0 : state.current + 1;

			// Kviečiamas darbininkas:
			dispatch(worker, { el: msg.el, num: index });

			// Išsaugomas sekančio darbininko indeksas:
			return {...state, ["current"]: newCurrent };
		}
		else if (senderLast) {
			// Vykdoma, kai pro filtravimą praeina objektas, 
			// kurio "count" yra -1

			// Kviečiamas spausdinimo aktorius su atfiltruotais
			// ir surikiuotais duomenimis:
			dispatch(printer, {array: msg.array});
		}
	},
	'distributor'
);

// Rezultatų kaupiklio aktorius:
const res = spawn(
	system,
	(state = { 
		// Masyvas, kuriame saugomi surikiuoti objektai:
		"ansArray": []
	}, msg, ctx) => {

		// Paimamas masyvas, kuris naudojamas tolesnėse eilutėse:
		const ans = state["ansArray"];

		// Jei gauto objekto "count" yra -1,
		// siunčiamas saugomas masyvas skirstytuvui:
		if (msg.el["count"] == -1) {
			dispatch(distributor, {sender: "last", array: ans});
			return {...state, ["ansArray"]: ans};
		}
		
		// Jei masyvas tuščias, gautą objektą išsaugome masyve:
		if (ans.length == 0) {
			return {...state, ["ansArray"]: [msg.el] };
		}

		// Jei objekto kaina yra mažesnė nei pirmo objekto masyve,
		// naujas objektas dedamas į masyvo pradžią:
		if (ans[0]["price"] > msg.el["price"]) {
			return {...state, ["ansArray"]: [msg.el].concat(ans) };
		}

		// Jei objekto kaina yra nemažesnė nei paskutinio objekto masyve,
		// naujas objektas dedamas į masyvo pabaigą:
		if (ans[ans.length - 1]["price"] <= msg.el["price"]) {
			return {...state, ["ansArray"]: ans.concat(msg.el) };
		}

		// Jei prieinama iki čia, objektas turės būti masyvo viduryje

		// Randama reikšmė masyve, kuri eis prieš naują objektą:
		const num = ans.reduce(function (val, cur) {
			if (cur["price"] < msg.el["price"]) {
				val = cur;
			}
			return val;
		}, {});

		// Naudojama gauta reikšmė randant indeksą, kuriame bus įdėtas naujas objektas:
		const condition = (element) => element["price"] > num["price"];
		const index = ans.findIndex(condition);

		// Masyvas išskirstomas į dvi dalis per gautą indeksą:
		const left = ans.slice(0, index);
		const right = ans.slice(index);

		// Išsaugomas naujas masyvas su įterptu objektu:
		return {...state, ["ansArray"]: left.concat(msg.el).concat(right)};
	},
	'res'
);

// Spausdinimo aktorius:
const printer = spawn(
	system,
	(state = {}, msg, ctx) => {

		// Gaunamas rezultatų masyvas:
		const ans = msg.array;

		// start objektas perrašo rezultatų failą ir palieka jį tuščią:
		const start = fs.createWriteStream(outputFileName, {
			flags: 'w'
		});

		start.write("");
		start.end();

		// o objektas naudojamas rašyti duomenis į rezultatų failą:
		const o = fs.createWriteStream(outputFileName, {
			flags: 'a'
		});

		// Atspausdinami pradiniai duomenys:
		const line = "-".repeat(35);
		o.write("Pradiniai duomenys:\n\n");
		o.write(line + "\n");
		o.write("Nr.".padStart(4, ' ') + " | " + 
				"Code".padStart(11, ' ') + " | " + 
				"Count".padStart(6, ' ') + " | " + 
				"Price\n");
		o.write(line + "\n");

		obj.forEach(function(x, index) {
			o.write((index + 1).toString().padStart(4, ' ') + " | " + 
					x["code"].padStart(11, ' ') + " | " + 
					x["count"].toString().padStart(6, ' ') + " | " + 
					x["price"] + "\n");
		});
		o.write(line + "\n\n");

		// Atspausdinami rezultatai:
		const line2 = "-".repeat(103);
		o.write("Rezultatai:\n\n");
		o.write(line2 + "\n");
		o.write("Nr.".padStart(4, ' ') + " | " + 
				"Code".padStart(11, ' ') + " | " + 
				"Count".padStart(6, ' ') + " | " + 
				"Hash".padStart(65, ' ') + " | " +
				"Price\n");
		o.write(line2 + "\n");

		ans.forEach(function(x, index) {
			o.write((index + 1).toString().padStart(4, ' ') + " | " + 
					x["code"].padStart(11, ' ') + " | " + 
					x["count"].toString().padStart(6, ' ') + " | " + 
					x["hash"].toString().padStart(65, ' ') + " | " + 
					x["price"] + "\n");
		});
		o.write(line2);

		o.end();
	},
	'printer'
);


// Pagrindinis scenarijus:

// Kiekvienas iš failo nuskaitytas objektas siunčiamas skirstytuvui:  
obj.forEach(x => dispatch(distributor, { el: x, sender: "main" } ));

// Skirstytuvui siunčiamas specialus objektas, kurio "count" yra -1,
// šis objektas ateis paskutinis ir bus signalas rezultatų kaupikliui, 
// kad gautus rezultatus reikia siųsti spausdinimui:
dispatch(distributor, {
	el: {
		code: "dummy",
		price: 0,
		count: -1
	},
	sender: "main"
});