"""Constants shared by the integration and the wire protocol."""

DOMAIN = "gryfsmart"
VERSION = "0.2.1"
DEFAULT_PORT = 5000
BAUDRATE = 115200
TIMEOUT = 2.0
PLATFORMS = ["binary_sensor", "switch", "cover", "sensor", "event", "climate", "button", "number"]

# inputs, relay outputs, shutters, temperature channels, minimum firmware
PROFILES = {
    "ETH0606T": (6, 6, 0, 5, 25),
    "R0808": (8, 8, 0, 2, 25),
    "R0806T": (8, 6, 0, 2, 27),
    "S0804": (8, 0, 4, 0, 27),
    "R0806T-OLD": (8, 6, 0, 0, 4),
}
