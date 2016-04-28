#!/usr/bin/env node

// node modules
var fs = require("fs");
var url = require("url");
var path = require("path");
var util = require("util");
var querystring = require("querystring");

// npm modules
var debug = require("debug");
var express = require("express");
var request = require("request");
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
	.option("-s, --webhook [url]", "webhook url", function(v, s){ s.push(v); return s; }, [])
	.option("-v, --verbose", "say it loud", function(val, store){ store++; }, 0)
	.parse(process.argv);

// load config
var config = gchq()
	.file(path.resolve(__dirname, "../config.js"))
	.file(commander.config)
	.set("web", commander.web)
	.set("listen", commander.listen)
	.set("webhook", commander.webhook)
	.set("debug", (commander.verbose >= 0));

// set debugger
if (config.get("debug")) debug.enable("nsa");
var dbg = debug("nsa");

// check if listeners are configured
if (!config.get("listen")) {
	console.error("no listeners defined");
	process.exit(7);
}

// convert single listener and webhook config to array
if (config.type("listen") !== "array") config.set("listen", [config.get("listen")]);
if (config.type("webhook") !== "array") config.set("webhook", [config.get("webhook")]);

var webhook_send = function(type, message){
	if (config.get("webhook").length === 0) return;
	config.get("webhook").forEach(function(webhook_url){

		// add message to payload
		var payload = { text: message };

		// extract config from url
		webhook_url = url.parse(webhook_url);
		if (webhook_url.hasOwnProperty("hash") && (typeof webhook_url.hash === "string") && webhook_url.hash.length > 1) payload.channel = webhook_url.hash;
		if (webhook_url.hasOwnProperty("auth") && (typeof webhook_url.auth === "string") && webhook_url.auth.length > 0) payload.username = webhook_url.auth.split(/:/g).shift();
		var types = (webhook_url.hasOwnProperty("query") && (typeof webhook_url.query === "string") && webhook_url.query.length > 0) ? webhook_url.query.split(/[^a-z]/g) : ["all"];
		webhook_url.hash = null;
		webhook_url.auth = null;
		webhook_url.query = null;
		webhook_url = url.format(webhook_url);

		// check for type
		if (types.indexOf(type) < 0 && types.indexOf("all") < 0) return;

		request({
			method: "POST",
			url: webhook_url,
			form: { "payload": JSON.stringify(payload) }
		}, function (err, resp, data) {
			if (err) return debug("could not send notification to webhook: %o", err.message);
		});
	});
};	

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
	}).on("node+inactive", function(id, service, node){
		io.sockets.emit("inactive", id);
		webhook_send("inactive", util.format("Inactive: %s@%s", service, node))
	}).on("node+register", function(id, service, node){
		io.sockets.emit("register", id);
		webhook_send("register", util.format("New Node: %s@%s", service, node))
	}).on("node+active", function(id, service, node){
		io.sockets.emit("active", id);
		webhook_send("active", util.format("Active: %s@%s", service, node))
	}).on("node+reset", function(id, service, node){
		io.sockets.emit("reset", id);
		webhook_send("reset", util.format("Reset: %s@%s", service, node))
	}).on("node+retire", function(id, service, node){
		io.sockets.emit("remove", id);
		webhook_send("remove", util.format("Retired: %s@%s", service, node))
	}).on("error", function(err){
		debug("CIA Error: %o", err.message);
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

