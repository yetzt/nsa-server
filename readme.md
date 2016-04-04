# NSA

NSA sees all, because NSA is the Networked Status Aggregator.

![nsa successful in europe](assets/images/nsa-promo.jpg)

The idea is simple: The NSA server receives heartbeats over network sockets (currently only udp) and displays running services on a web interface (and, in the future, maybe does other stuff with them).

NSA is as simple as possible: Clients just send heartbeats and nsa displays new clients on the go. Other than deciding on where to listen, no further configuration is required. Maybe some sort of simple authentication will be implemented, but for now it's all just working out of the box. 

This is the NSA server, the client is simply called [nsa](https://www.npmjs.org/package/nsa).

## Running a Server

### Install

````
npm install -g nsa-server
````

### Options

run `bin/nsa-server.js` with these options:

* `--config ./config.js` Load Config File from `$CWD/config.js`
* `--web http://localhost:9999/` HTTP Web Interface on `localhost` port `9999`
* `--web unix:/tmp/nsa.sock?mode=0760` Web Interface socket `/tmp/nsa.sock` with mode `0760`
* `--listen udp4://localhost:8888` Listen for Messages on `localhost` port `8888` with IPv4
* `--listen udp6://localhost:8888` Listen for Messages on `localhost` port `8888` with IPv6

You can use `--listen` more than once.

See also [config.js.dist](config.js.dist);


## Message Format

In case you want to expand it for your own purposes.

```` javascript
var message = [
	0,              // message format version
	0,              // message type (0=heartbeat,1=retire)
	0,              // sequence number of message
	"example",      // name of the service
	"example.host", // name of the node
	10000           // number of microseconds till next message
];
````
