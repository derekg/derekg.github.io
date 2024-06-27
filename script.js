// Utility functions to set and get cookies
function setCookie(name, value, days) {
    const d = new Date();
    d.setTime(d.getTime() + (days*24*60*60*1000));
    const expires = "expires=" + d.toUTCString();
    document.cookie = name + "=" + value + ";" + expires + ";path=/";
}

function getCookie(name) {
    const cname = name + "=";
    const decodedCookie = decodeURIComponent(document.cookie);
    const ca = decodedCookie.split(';');
    for(let i = 0; i < ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) === ' ') {
            c = c.substring(1);
        }
        if (c.indexOf(cname) === 0) {
            return c.substring(cname.length, c.length);
        }
    }
    return "";
}

function loadDefaults() {
    const form = document.getElementById("questionForm");
    const inputs = form.elements;

    for (let input of inputs) {
        if (input.type === "radio" && getCookie(input.name) === input.value) {
            input.checked = true;
        }
    }
}

function saveDefaults() {
    const form = document.getElementById("questionForm");
    const inputs = form.elements;

    for (let input of inputs) {
        if (input.type === "radio" && input.checked) {
            setCookie(input.name, input.value, 365);
        }
    }
}

function calculateTime() {
    const form = document.getElementById("questionForm");
    const inputs = form.elements;

    let time = 90;  // baseline time

    const adjustments = {
        kids: 60,
        wheelchair: 90,
        premium: -20,
        international: 30,
        tsa: -20,
        rental: 20,
        bags: 45,
        boardingPass: -20,
        peakTime: 30,
        majorAirport: 20
    };

    for (let input of inputs) {
        if (input.type === "radio" && input.checked && adjustments.hasOwnProperty(input.name)) {
            time += adjustments[input.name] * (input.value === "yes" ? 1 : 0);
        }
    }

    document.getElementById("result").innerText = `You should allocate at least ${time} minutes to get through the airport.`;
    saveDefaults();
}

// Load defaults on page load
window.onload = loadDefaults;