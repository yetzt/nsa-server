#!/usr/bin/env node

// node modules
var fs = require("fs");
var url = require("url");
var path = require("path");
var querystring = require("querystring");

// npm modules
var debug = require("debug");
var express = require("express");
var commander = require("commander");

// local modules
var cia = require("../lib/cia");
var gchq = require("../lib/gchq");

// load package.json
var pkg = require(path.resolve(__dirname, "../package.json"));

// parse arguments
commander
	.version(pkg.version)
	.option("-c, --config [config.js]", "config file")
	.option("-w, --web [url]", "web interface url")
	.option("-l, --listen [url]", "listen url", function(v, s){ s.push(v); return s; }, [])
	.option("-v, --verbose", "say it loud", function(val, store){ store++; }, 0)
	.parse(process.argv);

// load config
var config = gchq()
	.file(path.resolve(__dirname, "../config.js"))
	.file(commander.config)
	.set("web", commander.web)
	.set("listen", commander.listen)
	.set("debug", (commander.verbose >= 0));

// set debugger
if (config.get("debug")) debug.enable("nsa");
var dbg = debug("nsa");

// check if listeners are configured
if (!config.get("listen")) {
	console.error("no listeners defined");
	process.exit(7);
}

// convert single listener config to array
if (config.type("listen") !== "array") config.set("listen", [config.get("listen")]);

// initialize listeners
var listener = cia();

config.get("listen").forEach(function(l){
	listener.listen(l);
});

// listen according to config and stuff
(function(){

	if (!config.has("web") || config.type("web") !== "string") return console.error("no web interface configured") || process.exit(8);

	var _opts = querystring.parse(url.parse(config.get("web")).query);

	// initialize express
	var app = express();
	var server = require('http').createServer(app);
	var io = require("socket.io").listen(server, {log: false});

	// serve assets
	app.use("/assets", express.static(path.resolve(__dirname, "../assets")));

	// send index file
	app.get("/", function(req, res){
		res.sendFile(path.resolve(__dirname, "../assets/html/index.html"));
	});

	app.get("/check", function(req, res){
		res.json({status:true});
	});
	
	// show status pages if configured
	if (_opts.hasOwnProperty("status")) {
	
		// send nodes as json
		app.get("/nodes.json", function(req, res){
			listener.getnodes(function(nodes){
				res.json(nodes);
			});
		});

	};
	
	io.sockets.on('connection', function (socket) {
		listener.getnodes(function(nodes){
			socket.emit('nodes', nodes);
		});
	});
	
	listener.on("node+info", function(info){
		io.sockets.emit("info", info);
	}).on("node+inactive", function(id){
		io.sockets.emit("inactive", id);
	}).on("node+register", function(id){
		io.sockets.emit("register", id);
	}).on("node+active", function(id){
		io.sockets.emit("active", id);
	}).on("node+reset", function(id){
		io.sockets.emit("reset", id);
	}).on("node+retire", function(id){
		io.sockets.emit("remove", id);
	});
	
	var listen = url.parse(config.get("web"));
	
	switch (listen.protocol) {
		case "unix:": 
			// unlink old socket if present
			if (typeof listen.pathname !== "string" || listen.pathname === "") {
				console.error("specified socket path is invalid");
				process.exit(3);
			}
			
			// check if socket path is relative
			if (listen.hostname.substr(0,1) === ".") listen.pathname = path.resolve(__dirname, listen.hostname, listen.pathname)

			// add .sock to socket if not present
			if (!/\.sock(et)?$/.test(listen.pathname)) listen.pathname += ".sock";

			if (fs.existsSync(listen.pathname)) fs.unlinkSync(listen.pathname);
			if (fs.existsSync(listen.pathname)) {
				console.error("previous socket could not be unlinked");
				process.exit(4);
			}
			
			server.listen(listen.pathname, function(){
				dbg("listening on socket %s", listen.pathname);

				// check options
				if (listen.query) {
					var query = querystring.parse(listen.query);

					// change mode of socket if requested
					if (query.hasOwnProperty("mode")) {
						var mode = parseInt(query.mode, 8);
						if (!isNaN(mode) && mode <= 0777) {
							fs.chmod(listen.pathname, mode, function(err){
								if (err) return console.error("could not chmod", mode.toString(8), "socket", listen.pathname);
								dbg("change mode %s %s", mode.toString(8), listen.pathname);
							});
						}
					}
				}
				
			});
			
		break;
		case "https:":
			console.error("https is not supportet yet.");
			process.exit(5);
		break;
		case "http:":
			if (listen.hasOwnProperty("hostname") && typeof listen.hostname === "string" && listen.hostname !== "") {
				// listen on hostname and port
				server.listen((listen.port || 30826), listen.hostname, function(err){
					dbg("listening on %s", "http://"+listen.hostname+":"+(listen.port || 30826));
				});
			} else {
				server.listen((listen.port || 30826), function(err){
					dbg("listening on %s", "http://*:"+(listen.port || 30826));
				});
			}
		break;
		default: 
			console.error("hostname and port or socket for web interface not specified");
			process.exit(6)
		break;
	}
})();

