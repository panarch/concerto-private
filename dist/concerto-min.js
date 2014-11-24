(function () {/**
 * @license almond 0.3.0 Copyright (c) 2011-2014, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/jrburke/almond for details
 */
//Going sloppy to avoid 'use strict' string cost, but strict practices should
//be followed.
/*jslint sloppy: true */
/*global setTimeout: false */

var requirejs, require, define;
(function (undef) {
    var main, req, makeMap, handlers,
        defined = {},
        waiting = {},
        config = {},
        defining = {},
        hasOwn = Object.prototype.hasOwnProperty,
        aps = [].slice,
        jsSuffixRegExp = /\.js$/;

    function hasProp(obj, prop) {
        return hasOwn.call(obj, prop);
    }

    /**
     * Given a relative module name, like ./something, normalize it to
     * a real name that can be mapped to a path.
     * @param {String} name the relative name
     * @param {String} baseName a real name that the name arg is relative
     * to.
     * @returns {String} normalized name
     */
    function normalize(name, baseName) {
        var nameParts, nameSegment, mapValue, foundMap, lastIndex,
            foundI, foundStarMap, starI, i, j, part,
            baseParts = baseName && baseName.split("/"),
            map = config.map,
            starMap = (map && map['*']) || {};

        //Adjust any relative paths.
        if (name && name.charAt(0) === ".") {
            //If have a base name, try to normalize against it,
            //otherwise, assume it is a top-level require that will
            //be relative to baseUrl in the end.
            if (baseName) {
                //Convert baseName to array, and lop off the last part,
                //so that . matches that "directory" and not name of the baseName's
                //module. For instance, baseName of "one/two/three", maps to
                //"one/two/three.js", but we want the directory, "one/two" for
                //this normalization.
                baseParts = baseParts.slice(0, baseParts.length - 1);
                name = name.split('/');
                lastIndex = name.length - 1;

                // Node .js allowance:
                if (config.nodeIdCompat && jsSuffixRegExp.test(name[lastIndex])) {
                    name[lastIndex] = name[lastIndex].replace(jsSuffixRegExp, '');
                }

                name = baseParts.concat(name);

                //start trimDots
                for (i = 0; i < name.length; i += 1) {
                    part = name[i];
                    if (part === ".") {
                        name.splice(i, 1);
                        i -= 1;
                    } else if (part === "..") {
                        if (i === 1 && (name[2] === '..' || name[0] === '..')) {
                            //End of the line. Keep at least one non-dot
                            //path segment at the front so it can be mapped
                            //correctly to disk. Otherwise, there is likely
                            //no path mapping for a path starting with '..'.
                            //This can still fail, but catches the most reasonable
                            //uses of ..
                            break;
                        } else if (i > 0) {
                            name.splice(i - 1, 2);
                            i -= 2;
                        }
                    }
                }
                //end trimDots

                name = name.join("/");
            } else if (name.indexOf('./') === 0) {
                // No baseName, so this is ID is resolved relative
                // to baseUrl, pull off the leading dot.
                name = name.substring(2);
            }
        }

        //Apply map config if available.
        if ((baseParts || starMap) && map) {
            nameParts = name.split('/');

            for (i = nameParts.length; i > 0; i -= 1) {
                nameSegment = nameParts.slice(0, i).join("/");

                if (baseParts) {
                    //Find the longest baseName segment match in the config.
                    //So, do joins on the biggest to smallest lengths of baseParts.
                    for (j = baseParts.length; j > 0; j -= 1) {
                        mapValue = map[baseParts.slice(0, j).join('/')];

                        //baseName segment has  config, find if it has one for
                        //this name.
                        if (mapValue) {
                            mapValue = mapValue[nameSegment];
                            if (mapValue) {
                                //Match, update name to the new value.
                                foundMap = mapValue;
                                foundI = i;
                                break;
                            }
                        }
                    }
                }

                if (foundMap) {
                    break;
                }

                //Check for a star map match, but just hold on to it,
                //if there is a shorter segment match later in a matching
                //config, then favor over this star map.
                if (!foundStarMap && starMap && starMap[nameSegment]) {
                    foundStarMap = starMap[nameSegment];
                    starI = i;
                }
            }

            if (!foundMap && foundStarMap) {
                foundMap = foundStarMap;
                foundI = starI;
            }

            if (foundMap) {
                nameParts.splice(0, foundI, foundMap);
                name = nameParts.join('/');
            }
        }

        return name;
    }

    function makeRequire(relName, forceSync) {
        return function () {
            //A version of a require function that passes a moduleName
            //value for items that may need to
            //look up paths relative to the moduleName
            var args = aps.call(arguments, 0);

            //If first arg is not require('string'), and there is only
            //one arg, it is the array form without a callback. Insert
            //a null so that the following concat is correct.
            if (typeof args[0] !== 'string' && args.length === 1) {
                args.push(null);
            }
            return req.apply(undef, args.concat([relName, forceSync]));
        };
    }

    function makeNormalize(relName) {
        return function (name) {
            return normalize(name, relName);
        };
    }

    function makeLoad(depName) {
        return function (value) {
            defined[depName] = value;
        };
    }

    function callDep(name) {
        if (hasProp(waiting, name)) {
            var args = waiting[name];
            delete waiting[name];
            defining[name] = true;
            main.apply(undef, args);
        }

        if (!hasProp(defined, name) && !hasProp(defining, name)) {
            throw new Error('No ' + name);
        }
        return defined[name];
    }

    //Turns a plugin!resource to [plugin, resource]
    //with the plugin being undefined if the name
    //did not have a plugin prefix.
    function splitPrefix(name) {
        var prefix,
            index = name ? name.indexOf('!') : -1;
        if (index > -1) {
            prefix = name.substring(0, index);
            name = name.substring(index + 1, name.length);
        }
        return [prefix, name];
    }

    /**
     * Makes a name map, normalizing the name, and using a plugin
     * for normalization if necessary. Grabs a ref to plugin
     * too, as an optimization.
     */
    makeMap = function (name, relName) {
        var plugin,
            parts = splitPrefix(name),
            prefix = parts[0];

        name = parts[1];

        if (prefix) {
            prefix = normalize(prefix, relName);
            plugin = callDep(prefix);
        }

        //Normalize according
        if (prefix) {
            if (plugin && plugin.normalize) {
                name = plugin.normalize(name, makeNormalize(relName));
            } else {
                name = normalize(name, relName);
            }
        } else {
            name = normalize(name, relName);
            parts = splitPrefix(name);
            prefix = parts[0];
            name = parts[1];
            if (prefix) {
                plugin = callDep(prefix);
            }
        }

        //Using ridiculous property names for space reasons
        return {
            f: prefix ? prefix + '!' + name : name, //fullName
            n: name,
            pr: prefix,
            p: plugin
        };
    };

    function makeConfig(name) {
        return function () {
            return (config && config.config && config.config[name]) || {};
        };
    }

    handlers = {
        require: function (name) {
            return makeRequire(name);
        },
        exports: function (name) {
            var e = defined[name];
            if (typeof e !== 'undefined') {
                return e;
            } else {
                return (defined[name] = {});
            }
        },
        module: function (name) {
            return {
                id: name,
                uri: '',
                exports: defined[name],
                config: makeConfig(name)
            };
        }
    };

    main = function (name, deps, callback, relName) {
        var cjsModule, depName, ret, map, i,
            args = [],
            callbackType = typeof callback,
            usingExports;

        //Use name if no relName
        relName = relName || name;

        //Call the callback to define the module, if necessary.
        if (callbackType === 'undefined' || callbackType === 'function') {
            //Pull out the defined dependencies and pass the ordered
            //values to the callback.
            //Default to [require, exports, module] if no deps
            deps = !deps.length && callback.length ? ['require', 'exports', 'module'] : deps;
            for (i = 0; i < deps.length; i += 1) {
                map = makeMap(deps[i], relName);
                depName = map.f;

                //Fast path CommonJS standard dependencies.
                if (depName === "require") {
                    args[i] = handlers.require(name);
                } else if (depName === "exports") {
                    //CommonJS module spec 1.1
                    args[i] = handlers.exports(name);
                    usingExports = true;
                } else if (depName === "module") {
                    //CommonJS module spec 1.1
                    cjsModule = args[i] = handlers.module(name);
                } else if (hasProp(defined, depName) ||
                           hasProp(waiting, depName) ||
                           hasProp(defining, depName)) {
                    args[i] = callDep(depName);
                } else if (map.p) {
                    map.p.load(map.n, makeRequire(relName, true), makeLoad(depName), {});
                    args[i] = defined[depName];
                } else {
                    throw new Error(name + ' missing ' + depName);
                }
            }

            ret = callback ? callback.apply(defined[name], args) : undefined;

            if (name) {
                //If setting exports via "module" is in play,
                //favor that over return value and exports. After that,
                //favor a non-undefined return value over exports use.
                if (cjsModule && cjsModule.exports !== undef &&
                        cjsModule.exports !== defined[name]) {
                    defined[name] = cjsModule.exports;
                } else if (ret !== undef || !usingExports) {
                    //Use the return value from the function.
                    defined[name] = ret;
                }
            }
        } else if (name) {
            //May just be an object definition for the module. Only
            //worry about defining if have a module name.
            defined[name] = callback;
        }
    };

    requirejs = require = req = function (deps, callback, relName, forceSync, alt) {
        if (typeof deps === "string") {
            if (handlers[deps]) {
                //callback in this case is really relName
                return handlers[deps](callback);
            }
            //Just return the module wanted. In this scenario, the
            //deps arg is the module name, and second arg (if passed)
            //is just the relName.
            //Normalize module name, if it contains . or ..
            return callDep(makeMap(deps, callback).f);
        } else if (!deps.splice) {
            //deps is a config object, not an array.
            config = deps;
            if (config.deps) {
                req(config.deps, config.callback);
            }
            if (!callback) {
                return;
            }

            if (callback.splice) {
                //callback is an array, which means it is a dependency list.
                //Adjust args if there are dependencies
                deps = callback;
                callback = relName;
                relName = null;
            } else {
                deps = undef;
            }
        }

        //Support require(['a'])
        callback = callback || function () {};

        //If relName is a function, it is an errback handler,
        //so remove it.
        if (typeof relName === 'function') {
            relName = forceSync;
            forceSync = alt;
        }

        //Simulate async callback;
        if (forceSync) {
            main(undef, deps, callback, relName);
        } else {
            //Using a non-zero value because of concern for what old browsers
            //do, and latest browsers "upgrade" to 4 if lower value is used:
            //http://www.whatwg.org/specs/web-apps/current-work/multipage/timers.html#dom-windowtimers-settimeout:
            //If want a value immediately, use require('id') instead -- something
            //that works in almond on the global level, but not guaranteed and
            //unlikely to work in other AMD implementations.
            setTimeout(function () {
                main(undef, deps, callback, relName);
            }, 4);
        }

        return req;
    };

    /**
     * Just drops the config on the floor, but returns req in case
     * the config return value is used.
     */
    req.config = function (cfg) {
        return req(cfg);
    };

    /**
     * Expose module registry for debugging and tooling
     */
    requirejs._defined = defined;

    define = function (name, deps, callback) {

        //This module may not have dependencies
        if (!deps.splice) {
            //deps is not an array, so probably means
            //an object literal or factory function for
            //the value. Adjust args.
            callback = deps;
            deps = [];
        }

        if (!hasProp(defined, name) && !hasProp(waiting, name)) {
            waiting[name] = [name, deps, callback];
        }
    };

    define.amd = {
        jQuery: true
    };
}());

define("almond", function(){});

// Concerto Base Libraries.
// Taehoon Moon <panarch@kaist.ac.kr>
//
// Table
//
// Copyright Taehoon Moon 2014

define('Table',['require','exports','module'],function(require, exports, module) {
    var Table = {};

    Table.ACCIDENTAL_DICT = {
              'sharp': '#',
       'double-sharp': '##',
            'natural': 'n',
               'flat': 'b',
        'double-flat': 'bb'
    };

    Table.DEFAULT_CLEF = 'treble';
    Table.DEFAULT_TIME_BEATS = 4;
    Table.DEFAULT_TIME_BEAT_TYPE = 4;

    Table.DEFAULT_REST_PITCH = 'b/4';

    Table.FLAT_MAJOR_KEY_SIGNATURES = ['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb'];
    Table.SHARP_MAJOR_KEY_SIGNATURES = ['G', 'D', 'A', 'E', 'B', 'F#', 'C#'];

    Table.NOTE_TYPES = ['1024th', '512th', '256th', '128th',
        '64th', '32nd', '16th', 'eighth', 'quarter', 'half', 'whole', 'breve',
        'long', 'maxima'];

    Table.NOTE_VEX_QUARTER_INDEX = 8;
    Table.NOTE_VEX_TYPES = ['1024', '512', '256', '128',
        '64', '32', '16', '8', 'q', 'h', 'w', 'w',
        'w', 'w'];

    Table.NOTE_TYPE_DICT = {
        '1024th': '64',
         '512th': '64',
         '256th': '64',
         '128th': '128',
          '64th': '64',
          '32nd': '32',
          '16th': '16',
        'eighth': '8',
       'quarter': 'q',
          'half': 'h',
         'whole': 'w',
         'breve': 'w',
          'long': 'w',
        'maxima': 'w'
    };

    Table.NOTE_VEX_TYPE_DICT = {

    };

    Table.CLEF_TYPE_DICT = {
        'G/2': 'treble',
        'F/4': 'bass',
        'C/3': 'alto',
        'C/4': 'tenor',
        'C/1': 'soprano',
        'C/2': 'mezzo-soprano',
        'C/5': 'baritone-c',
        'F/3': 'baritone-f',
        'F/5': 'subbass',
        'G/1': 'french',
        'percussion/2': 'percussion'
    };

    Table.CLEF_VEX_TYPE_DICT = {
               'treble': { sign: 'G', line: 2 },
                 'bass': { sign: 'F', line: 4 },
                 'alto': { sign: 'C', line: 3 },
                'tenor': { sign: 'C', line: 4 },
              'soprano': { sign: 'C', line: 1 },
        'mezzo-soprano': { sign: 'C', line: 2 },
           'baritone-c': { sign: 'C', line: 5 },
           'baritone-f': { sign: 'F', line: 3 },
              'subbass': { sign: 'F', line: 5 },
               'french': { sign: 'G', line: 1 },
           'percussion': { sign: 'percussion', line: 2 }
    };

    Table.STAVE_DEFAULT_OPTIONS = {
        'space_above_staff_ln': 0
    };

    module.exports = Table;
});

/*!
 * js-logger - http://github.com/jonnyreeves/js-logger 
 * Jonny Reeves, http://jonnyreeves.co.uk/
 * js-logger may be freely distributed under the MIT license. 
 */

/*jshint sub:true*/
/*global console:true,define:true, module:true*/
(function (global) {
	

	// Top level module for the global, static logger instance.
	var Logger = { };
	
	// For those that are at home that are keeping score.
	Logger.VERSION = "0.9.14";
	
	// Function which handles all incoming log messages.
	var logHandler;
	
	// Map of ContextualLogger instances by name; used by Logger.get() to return the same named instance.
	var contextualLoggersByNameMap = {};
	
	// Polyfill for ES5's Function.bind.
	var bind = function(scope, func) {
		return function() {
			return func.apply(scope, arguments);
		};
	};

	// Super exciting object merger-matron 9000 adding another 100 bytes to your download.
	var merge = function () {
		var args = arguments, target = args[0], key, i;
		for (i = 1; i < args.length; i++) {
			for (key in args[i]) {
				if (!(key in target) && args[i].hasOwnProperty(key)) {
					target[key] = args[i][key];
				}
			}
		}
		return target;
	};

	// Helper to define a logging level object; helps with optimisation.
	var defineLogLevel = function(value, name) {
		return { value: value, name: name };
	};

	// Predefined logging levels.
	Logger.DEBUG = defineLogLevel(1, 'DEBUG');
	Logger.INFO = defineLogLevel(2, 'INFO');
	Logger.WARN = defineLogLevel(4, 'WARN');
	Logger.ERROR = defineLogLevel(8, 'ERROR');
	Logger.OFF = defineLogLevel(99, 'OFF');

	// Inner class which performs the bulk of the work; ContextualLogger instances can be configured independently
	// of each other.
	var ContextualLogger = function(defaultContext) {
		this.context = defaultContext;
		this.setLevel(defaultContext.filterLevel);
		this.log = this.info;  // Convenience alias.
	};

	ContextualLogger.prototype = {
		// Changes the current logging level for the logging instance.
		setLevel: function (newLevel) {
			// Ensure the supplied Level object looks valid.
			if (newLevel && "value" in newLevel) {
				this.context.filterLevel = newLevel;
			}
		},

		// Is the logger configured to output messages at the supplied level?
		enabledFor: function (lvl) {
			var filterLevel = this.context.filterLevel;
			return lvl.value >= filterLevel.value;
		},

		debug: function () {
			this.invoke(Logger.DEBUG, arguments);
		},

		info: function () {
			this.invoke(Logger.INFO, arguments);
		},

		warn: function () {
			this.invoke(Logger.WARN, arguments);
		},

		error: function () {
			this.invoke(Logger.ERROR, arguments);
		},

		// Invokes the logger callback if it's not being filtered.
		invoke: function (level, msgArgs) {
			if (logHandler && this.enabledFor(level)) {
				logHandler(msgArgs, merge({ level: level }, this.context));
			}
		}
	};

	// Protected instance which all calls to the to level `Logger` module will be routed through.
	var globalLogger = new ContextualLogger({ filterLevel: Logger.OFF });

	// Configure the global Logger instance.
	(function() {
		// Shortcut for optimisers.
		var L = Logger;

		L.enabledFor = bind(globalLogger, globalLogger.enabledFor);
		L.debug = bind(globalLogger, globalLogger.debug);
		L.info = bind(globalLogger, globalLogger.info);
		L.warn = bind(globalLogger, globalLogger.warn);
		L.error = bind(globalLogger, globalLogger.error);

		// Don't forget the convenience alias!
		L.log = L.info;
	}());

	// Set the global logging handler.  The supplied function should expect two arguments, the first being an arguments
	// object with the supplied log messages and the second being a context object which contains a hash of stateful
	// parameters which the logging function can consume.
	Logger.setHandler = function (func) {
		logHandler = func;
	};

	// Sets the global logging filter level which applies to *all* previously registered, and future Logger instances.
	// (note that named loggers (retrieved via `Logger.get`) can be configured independently if required).
	Logger.setLevel = function(level) {
		// Set the globalLogger's level.
		globalLogger.setLevel(level);

		// Apply this level to all registered contextual loggers.
		for (var key in contextualLoggersByNameMap) {
			if (contextualLoggersByNameMap.hasOwnProperty(key)) {
				contextualLoggersByNameMap[key].setLevel(level);
			}
		}
	};

	// Retrieve a ContextualLogger instance.  Note that named loggers automatically inherit the global logger's level,
	// default context and log handler.
	Logger.get = function (name) {
		// All logger instances are cached so they can be configured ahead of use.
		return contextualLoggersByNameMap[name] ||
			(contextualLoggersByNameMap[name] = new ContextualLogger(merge({ name: name }, globalLogger.context)));
	};

	// Configure and example a Default implementation which writes to the `window.console` (if present).
	Logger.useDefaults = function(defaultLevel) {
		// Check for the presence of a logger.
		if (typeof console === "undefined") {
			return;
		}

		Logger.setLevel(defaultLevel || Logger.DEBUG);
		Logger.setHandler(function(messages, context) {
			var hdlr = console.log;

			// Prepend the logger's name to the log message for easy identification.
			if (context.name) {
				messages[0] = "[" + context.name + "] " + messages[0];
			}

			// Delegate through to custom warn/error loggers if present on the console.
			if (context.level === Logger.WARN && console.warn) {
				hdlr = console.warn;
			} else if (context.level === Logger.ERROR && console.error) {
				hdlr = console.error;
			} else if (context.level === Logger.INFO && console.info) {
				hdlr = console.info;
			}

			// Support for IE8+ (and other, slightly more sane environments)
			Function.prototype.apply.call(hdlr, console, messages);
		});
	};

	// Export to popular environments boilerplate.
	if (typeof define === 'function' && define.amd) {
		define('js-logger',Logger);
	}
	else if (typeof module !== 'undefined' && module.exports) {
		module.exports = Logger;
	}
	else {
		Logger._prevLogger = global.Logger;

		Logger.noConflict = function () {
			global.Logger = Logger._prevLogger;
			return Logger;
		};

		global.Logger = Logger;
    }
}(this));
/*!
 * jQuery JavaScript Library v2.1.1
 * http://jquery.com/
 *
 * Includes Sizzle.js
 * http://sizzlejs.com/
 *
 * Copyright 2005, 2014 jQuery Foundation, Inc. and other contributors
 * Released under the MIT license
 * http://jquery.org/license
 *
 * Date: 2014-05-01T17:11Z
 */

(function( global, factory ) {

	if ( typeof module === "object" && typeof module.exports === "object" ) {
		// For CommonJS and CommonJS-like environments where a proper window is present,
		// execute the factory and get jQuery
		// For environments that do not inherently posses a window with a document
		// (such as Node.js), expose a jQuery-making factory as module.exports
		// This accentuates the need for the creation of a real window
		// e.g. var jQuery = require("jquery")(window);
		// See ticket #14549 for more info
		module.exports = global.document ?
			factory( global, true ) :
			function( w ) {
				if ( !w.document ) {
					throw new Error( "jQuery requires a window with a document" );
				}
				return factory( w );
			};
	} else {
		factory( global );
	}

// Pass this if window is not defined yet
}(typeof window !== "undefined" ? window : this, function( window, noGlobal ) {

// Can't do this because several apps including ASP.NET trace
// the stack via arguments.caller.callee and Firefox dies if
// you try to trace through "use strict" call chains. (#13335)
// Support: Firefox 18+
//

var arr = [];

var slice = arr.slice;

var concat = arr.concat;

var push = arr.push;

var indexOf = arr.indexOf;

var class2type = {};

var toString = class2type.toString;

var hasOwn = class2type.hasOwnProperty;

var support = {};



var
	// Use the correct document accordingly with window argument (sandbox)
	document = window.document,

	version = "2.1.1",

	// Define a local copy of jQuery
	jQuery = function( selector, context ) {
		// The jQuery object is actually just the init constructor 'enhanced'
		// Need init if jQuery is called (just allow error to be thrown if not included)
		return new jQuery.fn.init( selector, context );
	},

	// Support: Android<4.1
	// Make sure we trim BOM and NBSP
	rtrim = /^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g,

	// Matches dashed string for camelizing
	rmsPrefix = /^-ms-/,
	rdashAlpha = /-([\da-z])/gi,

	// Used by jQuery.camelCase as callback to replace()
	fcamelCase = function( all, letter ) {
		return letter.toUpperCase();
	};

jQuery.fn = jQuery.prototype = {
	// The current version of jQuery being used
	jquery: version,

	constructor: jQuery,

	// Start with an empty selector
	selector: "",

	// The default length of a jQuery object is 0
	length: 0,

	toArray: function() {
		return slice.call( this );
	},

	// Get the Nth element in the matched element set OR
	// Get the whole matched element set as a clean array
	get: function( num ) {
		return num != null ?

			// Return just the one element from the set
			( num < 0 ? this[ num + this.length ] : this[ num ] ) :

			// Return all the elements in a clean array
			slice.call( this );
	},

	// Take an array of elements and push it onto the stack
	// (returning the new matched element set)
	pushStack: function( elems ) {

		// Build a new jQuery matched element set
		var ret = jQuery.merge( this.constructor(), elems );

		// Add the old object onto the stack (as a reference)
		ret.prevObject = this;
		ret.context = this.context;

		// Return the newly-formed element set
		return ret;
	},

	// Execute a callback for every element in the matched set.
	// (You can seed the arguments with an array of args, but this is
	// only used internally.)
	each: function( callback, args ) {
		return jQuery.each( this, callback, args );
	},

	map: function( callback ) {
		return this.pushStack( jQuery.map(this, function( elem, i ) {
			return callback.call( elem, i, elem );
		}));
	},

	slice: function() {
		return this.pushStack( slice.apply( this, arguments ) );
	},

	first: function() {
		return this.eq( 0 );
	},

	last: function() {
		return this.eq( -1 );
	},

	eq: function( i ) {
		var len = this.length,
			j = +i + ( i < 0 ? len : 0 );
		return this.pushStack( j >= 0 && j < len ? [ this[j] ] : [] );
	},

	end: function() {
		return this.prevObject || this.constructor(null);
	},

	// For internal use only.
	// Behaves like an Array's method, not like a jQuery method.
	push: push,
	sort: arr.sort,
	splice: arr.splice
};

jQuery.extend = jQuery.fn.extend = function() {
	var options, name, src, copy, copyIsArray, clone,
		target = arguments[0] || {},
		i = 1,
		length = arguments.length,
		deep = false;

	// Handle a deep copy situation
	if ( typeof target === "boolean" ) {
		deep = target;

		// skip the boolean and the target
		target = arguments[ i ] || {};
		i++;
	}

	// Handle case when target is a string or something (possible in deep copy)
	if ( typeof target !== "object" && !jQuery.isFunction(target) ) {
		target = {};
	}

	// extend jQuery itself if only one argument is passed
	if ( i === length ) {
		target = this;
		i--;
	}

	for ( ; i < length; i++ ) {
		// Only deal with non-null/undefined values
		if ( (options = arguments[ i ]) != null ) {
			// Extend the base object
			for ( name in options ) {
				src = target[ name ];
				copy = options[ name ];

				// Prevent never-ending loop
				if ( target === copy ) {
					continue;
				}

				// Recurse if we're merging plain objects or arrays
				if ( deep && copy && ( jQuery.isPlainObject(copy) || (copyIsArray = jQuery.isArray(copy)) ) ) {
					if ( copyIsArray ) {
						copyIsArray = false;
						clone = src && jQuery.isArray(src) ? src : [];

					} else {
						clone = src && jQuery.isPlainObject(src) ? src : {};
					}

					// Never move original objects, clone them
					target[ name ] = jQuery.extend( deep, clone, copy );

				// Don't bring in undefined values
				} else if ( copy !== undefined ) {
					target[ name ] = copy;
				}
			}
		}
	}

	// Return the modified object
	return target;
};

jQuery.extend({
	// Unique for each copy of jQuery on the page
	expando: "jQuery" + ( version + Math.random() ).replace( /\D/g, "" ),

	// Assume jQuery is ready without the ready module
	isReady: true,

	error: function( msg ) {
		throw new Error( msg );
	},

	noop: function() {},

	// See test/unit/core.js for details concerning isFunction.
	// Since version 1.3, DOM methods and functions like alert
	// aren't supported. They return false on IE (#2968).
	isFunction: function( obj ) {
		return jQuery.type(obj) === "function";
	},

	isArray: Array.isArray,

	isWindow: function( obj ) {
		return obj != null && obj === obj.window;
	},

	isNumeric: function( obj ) {
		// parseFloat NaNs numeric-cast false positives (null|true|false|"")
		// ...but misinterprets leading-number strings, particularly hex literals ("0x...")
		// subtraction forces infinities to NaN
		return !jQuery.isArray( obj ) && obj - parseFloat( obj ) >= 0;
	},

	isPlainObject: function( obj ) {
		// Not plain objects:
		// - Any object or value whose internal [[Class]] property is not "[object Object]"
		// - DOM nodes
		// - window
		if ( jQuery.type( obj ) !== "object" || obj.nodeType || jQuery.isWindow( obj ) ) {
			return false;
		}

		if ( obj.constructor &&
				!hasOwn.call( obj.constructor.prototype, "isPrototypeOf" ) ) {
			return false;
		}

		// If the function hasn't returned already, we're confident that
		// |obj| is a plain object, created by {} or constructed with new Object
		return true;
	},

	isEmptyObject: function( obj ) {
		var name;
		for ( name in obj ) {
			return false;
		}
		return true;
	},

	type: function( obj ) {
		if ( obj == null ) {
			return obj + "";
		}
		// Support: Android < 4.0, iOS < 6 (functionish RegExp)
		return typeof obj === "object" || typeof obj === "function" ?
			class2type[ toString.call(obj) ] || "object" :
			typeof obj;
	},

	// Evaluates a script in a global context
	globalEval: function( code ) {
		var script,
			indirect = eval;

		code = jQuery.trim( code );

		if ( code ) {
			// If the code includes a valid, prologue position
			// strict mode pragma, execute code by injecting a
			// script tag into the document.
			if ( code.indexOf("use strict") === 1 ) {
				script = document.createElement("script");
				script.text = code;
				document.head.appendChild( script ).parentNode.removeChild( script );
			} else {
			// Otherwise, avoid the DOM node creation, insertion
			// and removal by using an indirect global eval
				indirect( code );
			}
		}
	},

	// Convert dashed to camelCase; used by the css and data modules
	// Microsoft forgot to hump their vendor prefix (#9572)
	camelCase: function( string ) {
		return string.replace( rmsPrefix, "ms-" ).replace( rdashAlpha, fcamelCase );
	},

	nodeName: function( elem, name ) {
		return elem.nodeName && elem.nodeName.toLowerCase() === name.toLowerCase();
	},

	// args is for internal usage only
	each: function( obj, callback, args ) {
		var value,
			i = 0,
			length = obj.length,
			isArray = isArraylike( obj );

		if ( args ) {
			if ( isArray ) {
				for ( ; i < length; i++ ) {
					value = callback.apply( obj[ i ], args );

					if ( value === false ) {
						break;
					}
				}
			} else {
				for ( i in obj ) {
					value = callback.apply( obj[ i ], args );

					if ( value === false ) {
						break;
					}
				}
			}

		// A special, fast, case for the most common use of each
		} else {
			if ( isArray ) {
				for ( ; i < length; i++ ) {
					value = callback.call( obj[ i ], i, obj[ i ] );

					if ( value === false ) {
						break;
					}
				}
			} else {
				for ( i in obj ) {
					value = callback.call( obj[ i ], i, obj[ i ] );

					if ( value === false ) {
						break;
					}
				}
			}
		}

		return obj;
	},

	// Support: Android<4.1
	trim: function( text ) {
		return text == null ?
			"" :
			( text + "" ).replace( rtrim, "" );
	},

	// results is for internal usage only
	makeArray: function( arr, results ) {
		var ret = results || [];

		if ( arr != null ) {
			if ( isArraylike( Object(arr) ) ) {
				jQuery.merge( ret,
					typeof arr === "string" ?
					[ arr ] : arr
				);
			} else {
				push.call( ret, arr );
			}
		}

		return ret;
	},

	inArray: function( elem, arr, i ) {
		return arr == null ? -1 : indexOf.call( arr, elem, i );
	},

	merge: function( first, second ) {
		var len = +second.length,
			j = 0,
			i = first.length;

		for ( ; j < len; j++ ) {
			first[ i++ ] = second[ j ];
		}

		first.length = i;

		return first;
	},

	grep: function( elems, callback, invert ) {
		var callbackInverse,
			matches = [],
			i = 0,
			length = elems.length,
			callbackExpect = !invert;

		// Go through the array, only saving the items
		// that pass the validator function
		for ( ; i < length; i++ ) {
			callbackInverse = !callback( elems[ i ], i );
			if ( callbackInverse !== callbackExpect ) {
				matches.push( elems[ i ] );
			}
		}

		return matches;
	},

	// arg is for internal usage only
	map: function( elems, callback, arg ) {
		var value,
			i = 0,
			length = elems.length,
			isArray = isArraylike( elems ),
			ret = [];

		// Go through the array, translating each of the items to their new values
		if ( isArray ) {
			for ( ; i < length; i++ ) {
				value = callback( elems[ i ], i, arg );

				if ( value != null ) {
					ret.push( value );
				}
			}

		// Go through every key on the object,
		} else {
			for ( i in elems ) {
				value = callback( elems[ i ], i, arg );

				if ( value != null ) {
					ret.push( value );
				}
			}
		}

		// Flatten any nested arrays
		return concat.apply( [], ret );
	},

	// A global GUID counter for objects
	guid: 1,

	// Bind a function to a context, optionally partially applying any
	// arguments.
	proxy: function( fn, context ) {
		var tmp, args, proxy;

		if ( typeof context === "string" ) {
			tmp = fn[ context ];
			context = fn;
			fn = tmp;
		}

		// Quick check to determine if target is callable, in the spec
		// this throws a TypeError, but we will just return undefined.
		if ( !jQuery.isFunction( fn ) ) {
			return undefined;
		}

		// Simulated bind
		args = slice.call( arguments, 2 );
		proxy = function() {
			return fn.apply( context || this, args.concat( slice.call( arguments ) ) );
		};

		// Set the guid of unique handler to the same of original handler, so it can be removed
		proxy.guid = fn.guid = fn.guid || jQuery.guid++;

		return proxy;
	},

	now: Date.now,

	// jQuery.support is not used in Core but other projects attach their
	// properties to it so it needs to exist.
	support: support
});

// Populate the class2type map
jQuery.each("Boolean Number String Function Array Date RegExp Object Error".split(" "), function(i, name) {
	class2type[ "[object " + name + "]" ] = name.toLowerCase();
});

function isArraylike( obj ) {
	var length = obj.length,
		type = jQuery.type( obj );

	if ( type === "function" || jQuery.isWindow( obj ) ) {
		return false;
	}

	if ( obj.nodeType === 1 && length ) {
		return true;
	}

	return type === "array" || length === 0 ||
		typeof length === "number" && length > 0 && ( length - 1 ) in obj;
}
var Sizzle =
/*!
 * Sizzle CSS Selector Engine v1.10.19
 * http://sizzlejs.com/
 *
 * Copyright 2013 jQuery Foundation, Inc. and other contributors
 * Released under the MIT license
 * http://jquery.org/license
 *
 * Date: 2014-04-18
 */
(function( window ) {

var i,
	support,
	Expr,
	getText,
	isXML,
	tokenize,
	compile,
	select,
	outermostContext,
	sortInput,
	hasDuplicate,

	// Local document vars
	setDocument,
	document,
	docElem,
	documentIsHTML,
	rbuggyQSA,
	rbuggyMatches,
	matches,
	contains,

	// Instance-specific data
	expando = "sizzle" + -(new Date()),
	preferredDoc = window.document,
	dirruns = 0,
	done = 0,
	classCache = createCache(),
	tokenCache = createCache(),
	compilerCache = createCache(),
	sortOrder = function( a, b ) {
		if ( a === b ) {
			hasDuplicate = true;
		}
		return 0;
	},

	// General-purpose constants
	strundefined = typeof undefined,
	MAX_NEGATIVE = 1 << 31,

	// Instance methods
	hasOwn = ({}).hasOwnProperty,
	arr = [],
	pop = arr.pop,
	push_native = arr.push,
	push = arr.push,
	slice = arr.slice,
	// Use a stripped-down indexOf if we can't use a native one
	indexOf = arr.indexOf || function( elem ) {
		var i = 0,
			len = this.length;
		for ( ; i < len; i++ ) {
			if ( this[i] === elem ) {
				return i;
			}
		}
		return -1;
	},

	booleans = "checked|selected|async|autofocus|autoplay|controls|defer|disabled|hidden|ismap|loop|multiple|open|readonly|required|scoped",

	// Regular expressions

	// Whitespace characters http://www.w3.org/TR/css3-selectors/#whitespace
	whitespace = "[\\x20\\t\\r\\n\\f]",
	// http://www.w3.org/TR/css3-syntax/#characters
	characterEncoding = "(?:\\\\.|[\\w-]|[^\\x00-\\xa0])+",

	// Loosely modeled on CSS identifier characters
	// An unquoted value should be a CSS identifier http://www.w3.org/TR/css3-selectors/#attribute-selectors
	// Proper syntax: http://www.w3.org/TR/CSS21/syndata.html#value-def-identifier
	identifier = characterEncoding.replace( "w", "w#" ),

	// Attribute selectors: http://www.w3.org/TR/selectors/#attribute-selectors
	attributes = "\\[" + whitespace + "*(" + characterEncoding + ")(?:" + whitespace +
		// Operator (capture 2)
		"*([*^$|!~]?=)" + whitespace +
		// "Attribute values must be CSS identifiers [capture 5] or strings [capture 3 or capture 4]"
		"*(?:'((?:\\\\.|[^\\\\'])*)'|\"((?:\\\\.|[^\\\\\"])*)\"|(" + identifier + "))|)" + whitespace +
		"*\\]",

	pseudos = ":(" + characterEncoding + ")(?:\\((" +
		// To reduce the number of selectors needing tokenize in the preFilter, prefer arguments:
		// 1. quoted (capture 3; capture 4 or capture 5)
		"('((?:\\\\.|[^\\\\'])*)'|\"((?:\\\\.|[^\\\\\"])*)\")|" +
		// 2. simple (capture 6)
		"((?:\\\\.|[^\\\\()[\\]]|" + attributes + ")*)|" +
		// 3. anything else (capture 2)
		".*" +
		")\\)|)",

	// Leading and non-escaped trailing whitespace, capturing some non-whitespace characters preceding the latter
	rtrim = new RegExp( "^" + whitespace + "+|((?:^|[^\\\\])(?:\\\\.)*)" + whitespace + "+$", "g" ),

	rcomma = new RegExp( "^" + whitespace + "*," + whitespace + "*" ),
	rcombinators = new RegExp( "^" + whitespace + "*([>+~]|" + whitespace + ")" + whitespace + "*" ),

	rattributeQuotes = new RegExp( "=" + whitespace + "*([^\\]'\"]*?)" + whitespace + "*\\]", "g" ),

	rpseudo = new RegExp( pseudos ),
	ridentifier = new RegExp( "^" + identifier + "$" ),

	matchExpr = {
		"ID": new RegExp( "^#(" + characterEncoding + ")" ),
		"CLASS": new RegExp( "^\\.(" + characterEncoding + ")" ),
		"TAG": new RegExp( "^(" + characterEncoding.replace( "w", "w*" ) + ")" ),
		"ATTR": new RegExp( "^" + attributes ),
		"PSEUDO": new RegExp( "^" + pseudos ),
		"CHILD": new RegExp( "^:(only|first|last|nth|nth-last)-(child|of-type)(?:\\(" + whitespace +
			"*(even|odd|(([+-]|)(\\d*)n|)" + whitespace + "*(?:([+-]|)" + whitespace +
			"*(\\d+)|))" + whitespace + "*\\)|)", "i" ),
		"bool": new RegExp( "^(?:" + booleans + ")$", "i" ),
		// For use in libraries implementing .is()
		// We use this for POS matching in `select`
		"needsContext": new RegExp( "^" + whitespace + "*[>+~]|:(even|odd|eq|gt|lt|nth|first|last)(?:\\(" +
			whitespace + "*((?:-\\d)?\\d*)" + whitespace + "*\\)|)(?=[^-]|$)", "i" )
	},

	rinputs = /^(?:input|select|textarea|button)$/i,
	rheader = /^h\d$/i,

	rnative = /^[^{]+\{\s*\[native \w/,

	// Easily-parseable/retrievable ID or TAG or CLASS selectors
	rquickExpr = /^(?:#([\w-]+)|(\w+)|\.([\w-]+))$/,

	rsibling = /[+~]/,
	rescape = /'|\\/g,

	// CSS escapes http://www.w3.org/TR/CSS21/syndata.html#escaped-characters
	runescape = new RegExp( "\\\\([\\da-f]{1,6}" + whitespace + "?|(" + whitespace + ")|.)", "ig" ),
	funescape = function( _, escaped, escapedWhitespace ) {
		var high = "0x" + escaped - 0x10000;
		// NaN means non-codepoint
		// Support: Firefox<24
		// Workaround erroneous numeric interpretation of +"0x"
		return high !== high || escapedWhitespace ?
			escaped :
			high < 0 ?
				// BMP codepoint
				String.fromCharCode( high + 0x10000 ) :
				// Supplemental Plane codepoint (surrogate pair)
				String.fromCharCode( high >> 10 | 0xD800, high & 0x3FF | 0xDC00 );
	};

// Optimize for push.apply( _, NodeList )
try {
	push.apply(
		(arr = slice.call( preferredDoc.childNodes )),
		preferredDoc.childNodes
	);
	// Support: Android<4.0
	// Detect silently failing push.apply
	arr[ preferredDoc.childNodes.length ].nodeType;
} catch ( e ) {
	push = { apply: arr.length ?

		// Leverage slice if possible
		function( target, els ) {
			push_native.apply( target, slice.call(els) );
		} :

		// Support: IE<9
		// Otherwise append directly
		function( target, els ) {
			var j = target.length,
				i = 0;
			// Can't trust NodeList.length
			while ( (target[j++] = els[i++]) ) {}
			target.length = j - 1;
		}
	};
}

function Sizzle( selector, context, results, seed ) {
	var match, elem, m, nodeType,
		// QSA vars
		i, groups, old, nid, newContext, newSelector;

	if ( ( context ? context.ownerDocument || context : preferredDoc ) !== document ) {
		setDocument( context );
	}

	context = context || document;
	results = results || [];

	if ( !selector || typeof selector !== "string" ) {
		return results;
	}

	if ( (nodeType = context.nodeType) !== 1 && nodeType !== 9 ) {
		return [];
	}

	if ( documentIsHTML && !seed ) {

		// Shortcuts
		if ( (match = rquickExpr.exec( selector )) ) {
			// Speed-up: Sizzle("#ID")
			if ( (m = match[1]) ) {
				if ( nodeType === 9 ) {
					elem = context.getElementById( m );
					// Check parentNode to catch when Blackberry 4.6 returns
					// nodes that are no longer in the document (jQuery #6963)
					if ( elem && elem.parentNode ) {
						// Handle the case where IE, Opera, and Webkit return items
						// by name instead of ID
						if ( elem.id === m ) {
							results.push( elem );
							return results;
						}
					} else {
						return results;
					}
				} else {
					// Context is not a document
					if ( context.ownerDocument && (elem = context.ownerDocument.getElementById( m )) &&
						contains( context, elem ) && elem.id === m ) {
						results.push( elem );
						return results;
					}
				}

			// Speed-up: Sizzle("TAG")
			} else if ( match[2] ) {
				push.apply( results, context.getElementsByTagName( selector ) );
				return results;

			// Speed-up: Sizzle(".CLASS")
			} else if ( (m = match[3]) && support.getElementsByClassName && context.getElementsByClassName ) {
				push.apply( results, context.getElementsByClassName( m ) );
				return results;
			}
		}

		// QSA path
		if ( support.qsa && (!rbuggyQSA || !rbuggyQSA.test( selector )) ) {
			nid = old = expando;
			newContext = context;
			newSelector = nodeType === 9 && selector;

			// qSA works strangely on Element-rooted queries
			// We can work around this by specifying an extra ID on the root
			// and working up from there (Thanks to Andrew Dupont for the technique)
			// IE 8 doesn't work on object elements
			if ( nodeType === 1 && context.nodeName.toLowerCase() !== "object" ) {
				groups = tokenize( selector );

				if ( (old = context.getAttribute("id")) ) {
					nid = old.replace( rescape, "\\$&" );
				} else {
					context.setAttribute( "id", nid );
				}
				nid = "[id='" + nid + "'] ";

				i = groups.length;
				while ( i-- ) {
					groups[i] = nid + toSelector( groups[i] );
				}
				newContext = rsibling.test( selector ) && testContext( context.parentNode ) || context;
				newSelector = groups.join(",");
			}

			if ( newSelector ) {
				try {
					push.apply( results,
						newContext.querySelectorAll( newSelector )
					);
					return results;
				} catch(qsaError) {
				} finally {
					if ( !old ) {
						context.removeAttribute("id");
					}
				}
			}
		}
	}

	// All others
	return select( selector.replace( rtrim, "$1" ), context, results, seed );
}

/**
 * Create key-value caches of limited size
 * @returns {Function(string, Object)} Returns the Object data after storing it on itself with
 *	property name the (space-suffixed) string and (if the cache is larger than Expr.cacheLength)
 *	deleting the oldest entry
 */
function createCache() {
	var keys = [];

	function cache( key, value ) {
		// Use (key + " ") to avoid collision with native prototype properties (see Issue #157)
		if ( keys.push( key + " " ) > Expr.cacheLength ) {
			// Only keep the most recent entries
			delete cache[ keys.shift() ];
		}
		return (cache[ key + " " ] = value);
	}
	return cache;
}

/**
 * Mark a function for special use by Sizzle
 * @param {Function} fn The function to mark
 */
function markFunction( fn ) {
	fn[ expando ] = true;
	return fn;
}

/**
 * Support testing using an element
 * @param {Function} fn Passed the created div and expects a boolean result
 */
function assert( fn ) {
	var div = document.createElement("div");

	try {
		return !!fn( div );
	} catch (e) {
		return false;
	} finally {
		// Remove from its parent by default
		if ( div.parentNode ) {
			div.parentNode.removeChild( div );
		}
		// release memory in IE
		div = null;
	}
}

/**
 * Adds the same handler for all of the specified attrs
 * @param {String} attrs Pipe-separated list of attributes
 * @param {Function} handler The method that will be applied
 */
function addHandle( attrs, handler ) {
	var arr = attrs.split("|"),
		i = attrs.length;

	while ( i-- ) {
		Expr.attrHandle[ arr[i] ] = handler;
	}
}

/**
 * Checks document order of two siblings
 * @param {Element} a
 * @param {Element} b
 * @returns {Number} Returns less than 0 if a precedes b, greater than 0 if a follows b
 */
function siblingCheck( a, b ) {
	var cur = b && a,
		diff = cur && a.nodeType === 1 && b.nodeType === 1 &&
			( ~b.sourceIndex || MAX_NEGATIVE ) -
			( ~a.sourceIndex || MAX_NEGATIVE );

	// Use IE sourceIndex if available on both nodes
	if ( diff ) {
		return diff;
	}

	// Check if b follows a
	if ( cur ) {
		while ( (cur = cur.nextSibling) ) {
			if ( cur === b ) {
				return -1;
			}
		}
	}

	return a ? 1 : -1;
}

/**
 * Returns a function to use in pseudos for input types
 * @param {String} type
 */
function createInputPseudo( type ) {
	return function( elem ) {
		var name = elem.nodeName.toLowerCase();
		return name === "input" && elem.type === type;
	};
}

/**
 * Returns a function to use in pseudos for buttons
 * @param {String} type
 */
function createButtonPseudo( type ) {
	return function( elem ) {
		var name = elem.nodeName.toLowerCase();
		return (name === "input" || name === "button") && elem.type === type;
	};
}

/**
 * Returns a function to use in pseudos for positionals
 * @param {Function} fn
 */
function createPositionalPseudo( fn ) {
	return markFunction(function( argument ) {
		argument = +argument;
		return markFunction(function( seed, matches ) {
			var j,
				matchIndexes = fn( [], seed.length, argument ),
				i = matchIndexes.length;

			// Match elements found at the specified indexes
			while ( i-- ) {
				if ( seed[ (j = matchIndexes[i]) ] ) {
					seed[j] = !(matches[j] = seed[j]);
				}
			}
		});
	});
}

/**
 * Checks a node for validity as a Sizzle context
 * @param {Element|Object=} context
 * @returns {Element|Object|Boolean} The input node if acceptable, otherwise a falsy value
 */
function testContext( context ) {
	return context && typeof context.getElementsByTagName !== strundefined && context;
}

// Expose support vars for convenience
support = Sizzle.support = {};

/**
 * Detects XML nodes
 * @param {Element|Object} elem An element or a document
 * @returns {Boolean} True iff elem is a non-HTML XML node
 */
isXML = Sizzle.isXML = function( elem ) {
	// documentElement is verified for cases where it doesn't yet exist
	// (such as loading iframes in IE - #4833)
	var documentElement = elem && (elem.ownerDocument || elem).documentElement;
	return documentElement ? documentElement.nodeName !== "HTML" : false;
};

/**
 * Sets document-related variables once based on the current document
 * @param {Element|Object} [doc] An element or document object to use to set the document
 * @returns {Object} Returns the current document
 */
setDocument = Sizzle.setDocument = function( node ) {
	var hasCompare,
		doc = node ? node.ownerDocument || node : preferredDoc,
		parent = doc.defaultView;

	// If no document and documentElement is available, return
	if ( doc === document || doc.nodeType !== 9 || !doc.documentElement ) {
		return document;
	}

	// Set our document
	document = doc;
	docElem = doc.documentElement;

	// Support tests
	documentIsHTML = !isXML( doc );

	// Support: IE>8
	// If iframe document is assigned to "document" variable and if iframe has been reloaded,
	// IE will throw "permission denied" error when accessing "document" variable, see jQuery #13936
	// IE6-8 do not support the defaultView property so parent will be undefined
	if ( parent && parent !== parent.top ) {
		// IE11 does not have attachEvent, so all must suffer
		if ( parent.addEventListener ) {
			parent.addEventListener( "unload", function() {
				setDocument();
			}, false );
		} else if ( parent.attachEvent ) {
			parent.attachEvent( "onunload", function() {
				setDocument();
			});
		}
	}

	/* Attributes
	---------------------------------------------------------------------- */

	// Support: IE<8
	// Verify that getAttribute really returns attributes and not properties (excepting IE8 booleans)
	support.attributes = assert(function( div ) {
		div.className = "i";
		return !div.getAttribute("className");
	});

	/* getElement(s)By*
	---------------------------------------------------------------------- */

	// Check if getElementsByTagName("*") returns only elements
	support.getElementsByTagName = assert(function( div ) {
		div.appendChild( doc.createComment("") );
		return !div.getElementsByTagName("*").length;
	});

	// Check if getElementsByClassName can be trusted
	support.getElementsByClassName = rnative.test( doc.getElementsByClassName ) && assert(function( div ) {
		div.innerHTML = "<div class='a'></div><div class='a i'></div>";

		// Support: Safari<4
		// Catch class over-caching
		div.firstChild.className = "i";
		// Support: Opera<10
		// Catch gEBCN failure to find non-leading classes
		return div.getElementsByClassName("i").length === 2;
	});

	// Support: IE<10
	// Check if getElementById returns elements by name
	// The broken getElementById methods don't pick up programatically-set names,
	// so use a roundabout getElementsByName test
	support.getById = assert(function( div ) {
		docElem.appendChild( div ).id = expando;
		return !doc.getElementsByName || !doc.getElementsByName( expando ).length;
	});

	// ID find and filter
	if ( support.getById ) {
		Expr.find["ID"] = function( id, context ) {
			if ( typeof context.getElementById !== strundefined && documentIsHTML ) {
				var m = context.getElementById( id );
				// Check parentNode to catch when Blackberry 4.6 returns
				// nodes that are no longer in the document #6963
				return m && m.parentNode ? [ m ] : [];
			}
		};
		Expr.filter["ID"] = function( id ) {
			var attrId = id.replace( runescape, funescape );
			return function( elem ) {
				return elem.getAttribute("id") === attrId;
			};
		};
	} else {
		// Support: IE6/7
		// getElementById is not reliable as a find shortcut
		delete Expr.find["ID"];

		Expr.filter["ID"] =  function( id ) {
			var attrId = id.replace( runescape, funescape );
			return function( elem ) {
				var node = typeof elem.getAttributeNode !== strundefined && elem.getAttributeNode("id");
				return node && node.value === attrId;
			};
		};
	}

	// Tag
	Expr.find["TAG"] = support.getElementsByTagName ?
		function( tag, context ) {
			if ( typeof context.getElementsByTagName !== strundefined ) {
				return context.getElementsByTagName( tag );
			}
		} :
		function( tag, context ) {
			var elem,
				tmp = [],
				i = 0,
				results = context.getElementsByTagName( tag );

			// Filter out possible comments
			if ( tag === "*" ) {
				while ( (elem = results[i++]) ) {
					if ( elem.nodeType === 1 ) {
						tmp.push( elem );
					}
				}

				return tmp;
			}
			return results;
		};

	// Class
	Expr.find["CLASS"] = support.getElementsByClassName && function( className, context ) {
		if ( typeof context.getElementsByClassName !== strundefined && documentIsHTML ) {
			return context.getElementsByClassName( className );
		}
	};

	/* QSA/matchesSelector
	---------------------------------------------------------------------- */

	// QSA and matchesSelector support

	// matchesSelector(:active) reports false when true (IE9/Opera 11.5)
	rbuggyMatches = [];

	// qSa(:focus) reports false when true (Chrome 21)
	// We allow this because of a bug in IE8/9 that throws an error
	// whenever `document.activeElement` is accessed on an iframe
	// So, we allow :focus to pass through QSA all the time to avoid the IE error
	// See http://bugs.jquery.com/ticket/13378
	rbuggyQSA = [];

	if ( (support.qsa = rnative.test( doc.querySelectorAll )) ) {
		// Build QSA regex
		// Regex strategy adopted from Diego Perini
		assert(function( div ) {
			// Select is set to empty string on purpose
			// This is to test IE's treatment of not explicitly
			// setting a boolean content attribute,
			// since its presence should be enough
			// http://bugs.jquery.com/ticket/12359
			div.innerHTML = "<select msallowclip=''><option selected=''></option></select>";

			// Support: IE8, Opera 11-12.16
			// Nothing should be selected when empty strings follow ^= or $= or *=
			// The test attribute must be unknown in Opera but "safe" for WinRT
			// http://msdn.microsoft.com/en-us/library/ie/hh465388.aspx#attribute_section
			if ( div.querySelectorAll("[msallowclip^='']").length ) {
				rbuggyQSA.push( "[*^$]=" + whitespace + "*(?:''|\"\")" );
			}

			// Support: IE8
			// Boolean attributes and "value" are not treated correctly
			if ( !div.querySelectorAll("[selected]").length ) {
				rbuggyQSA.push( "\\[" + whitespace + "*(?:value|" + booleans + ")" );
			}

			// Webkit/Opera - :checked should return selected option elements
			// http://www.w3.org/TR/2011/REC-css3-selectors-20110929/#checked
			// IE8 throws error here and will not see later tests
			if ( !div.querySelectorAll(":checked").length ) {
				rbuggyQSA.push(":checked");
			}
		});

		assert(function( div ) {
			// Support: Windows 8 Native Apps
			// The type and name attributes are restricted during .innerHTML assignment
			var input = doc.createElement("input");
			input.setAttribute( "type", "hidden" );
			div.appendChild( input ).setAttribute( "name", "D" );

			// Support: IE8
			// Enforce case-sensitivity of name attribute
			if ( div.querySelectorAll("[name=d]").length ) {
				rbuggyQSA.push( "name" + whitespace + "*[*^$|!~]?=" );
			}

			// FF 3.5 - :enabled/:disabled and hidden elements (hidden elements are still enabled)
			// IE8 throws error here and will not see later tests
			if ( !div.querySelectorAll(":enabled").length ) {
				rbuggyQSA.push( ":enabled", ":disabled" );
			}

			// Opera 10-11 does not throw on post-comma invalid pseudos
			div.querySelectorAll("*,:x");
			rbuggyQSA.push(",.*:");
		});
	}

	if ( (support.matchesSelector = rnative.test( (matches = docElem.matches ||
		docElem.webkitMatchesSelector ||
		docElem.mozMatchesSelector ||
		docElem.oMatchesSelector ||
		docElem.msMatchesSelector) )) ) {

		assert(function( div ) {
			// Check to see if it's possible to do matchesSelector
			// on a disconnected node (IE 9)
			support.disconnectedMatch = matches.call( div, "div" );

			// This should fail with an exception
			// Gecko does not error, returns false instead
			matches.call( div, "[s!='']:x" );
			rbuggyMatches.push( "!=", pseudos );
		});
	}

	rbuggyQSA = rbuggyQSA.length && new RegExp( rbuggyQSA.join("|") );
	rbuggyMatches = rbuggyMatches.length && new RegExp( rbuggyMatches.join("|") );

	/* Contains
	---------------------------------------------------------------------- */
	hasCompare = rnative.test( docElem.compareDocumentPosition );

	// Element contains another
	// Purposefully does not implement inclusive descendent
	// As in, an element does not contain itself
	contains = hasCompare || rnative.test( docElem.contains ) ?
		function( a, b ) {
			var adown = a.nodeType === 9 ? a.documentElement : a,
				bup = b && b.parentNode;
			return a === bup || !!( bup && bup.nodeType === 1 && (
				adown.contains ?
					adown.contains( bup ) :
					a.compareDocumentPosition && a.compareDocumentPosition( bup ) & 16
			));
		} :
		function( a, b ) {
			if ( b ) {
				while ( (b = b.parentNode) ) {
					if ( b === a ) {
						return true;
					}
				}
			}
			return false;
		};

	/* Sorting
	---------------------------------------------------------------------- */

	// Document order sorting
	sortOrder = hasCompare ?
	function( a, b ) {

		// Flag for duplicate removal
		if ( a === b ) {
			hasDuplicate = true;
			return 0;
		}

		// Sort on method existence if only one input has compareDocumentPosition
		var compare = !a.compareDocumentPosition - !b.compareDocumentPosition;
		if ( compare ) {
			return compare;
		}

		// Calculate position if both inputs belong to the same document
		compare = ( a.ownerDocument || a ) === ( b.ownerDocument || b ) ?
			a.compareDocumentPosition( b ) :

			// Otherwise we know they are disconnected
			1;

		// Disconnected nodes
		if ( compare & 1 ||
			(!support.sortDetached && b.compareDocumentPosition( a ) === compare) ) {

			// Choose the first element that is related to our preferred document
			if ( a === doc || a.ownerDocument === preferredDoc && contains(preferredDoc, a) ) {
				return -1;
			}
			if ( b === doc || b.ownerDocument === preferredDoc && contains(preferredDoc, b) ) {
				return 1;
			}

			// Maintain original order
			return sortInput ?
				( indexOf.call( sortInput, a ) - indexOf.call( sortInput, b ) ) :
				0;
		}

		return compare & 4 ? -1 : 1;
	} :
	function( a, b ) {
		// Exit early if the nodes are identical
		if ( a === b ) {
			hasDuplicate = true;
			return 0;
		}

		var cur,
			i = 0,
			aup = a.parentNode,
			bup = b.parentNode,
			ap = [ a ],
			bp = [ b ];

		// Parentless nodes are either documents or disconnected
		if ( !aup || !bup ) {
			return a === doc ? -1 :
				b === doc ? 1 :
				aup ? -1 :
				bup ? 1 :
				sortInput ?
				( indexOf.call( sortInput, a ) - indexOf.call( sortInput, b ) ) :
				0;

		// If the nodes are siblings, we can do a quick check
		} else if ( aup === bup ) {
			return siblingCheck( a, b );
		}

		// Otherwise we need full lists of their ancestors for comparison
		cur = a;
		while ( (cur = cur.parentNode) ) {
			ap.unshift( cur );
		}
		cur = b;
		while ( (cur = cur.parentNode) ) {
			bp.unshift( cur );
		}

		// Walk down the tree looking for a discrepancy
		while ( ap[i] === bp[i] ) {
			i++;
		}

		return i ?
			// Do a sibling check if the nodes have a common ancestor
			siblingCheck( ap[i], bp[i] ) :

			// Otherwise nodes in our document sort first
			ap[i] === preferredDoc ? -1 :
			bp[i] === preferredDoc ? 1 :
			0;
	};

	return doc;
};

Sizzle.matches = function( expr, elements ) {
	return Sizzle( expr, null, null, elements );
};

Sizzle.matchesSelector = function( elem, expr ) {
	// Set document vars if needed
	if ( ( elem.ownerDocument || elem ) !== document ) {
		setDocument( elem );
	}

	// Make sure that attribute selectors are quoted
	expr = expr.replace( rattributeQuotes, "='$1']" );

	if ( support.matchesSelector && documentIsHTML &&
		( !rbuggyMatches || !rbuggyMatches.test( expr ) ) &&
		( !rbuggyQSA     || !rbuggyQSA.test( expr ) ) ) {

		try {
			var ret = matches.call( elem, expr );

			// IE 9's matchesSelector returns false on disconnected nodes
			if ( ret || support.disconnectedMatch ||
					// As well, disconnected nodes are said to be in a document
					// fragment in IE 9
					elem.document && elem.document.nodeType !== 11 ) {
				return ret;
			}
		} catch(e) {}
	}

	return Sizzle( expr, document, null, [ elem ] ).length > 0;
};

Sizzle.contains = function( context, elem ) {
	// Set document vars if needed
	if ( ( context.ownerDocument || context ) !== document ) {
		setDocument( context );
	}
	return contains( context, elem );
};

Sizzle.attr = function( elem, name ) {
	// Set document vars if needed
	if ( ( elem.ownerDocument || elem ) !== document ) {
		setDocument( elem );
	}

	var fn = Expr.attrHandle[ name.toLowerCase() ],
		// Don't get fooled by Object.prototype properties (jQuery #13807)
		val = fn && hasOwn.call( Expr.attrHandle, name.toLowerCase() ) ?
			fn( elem, name, !documentIsHTML ) :
			undefined;

	return val !== undefined ?
		val :
		support.attributes || !documentIsHTML ?
			elem.getAttribute( name ) :
			(val = elem.getAttributeNode(name)) && val.specified ?
				val.value :
				null;
};

Sizzle.error = function( msg ) {
	throw new Error( "Syntax error, unrecognized expression: " + msg );
};

/**
 * Document sorting and removing duplicates
 * @param {ArrayLike} results
 */
Sizzle.uniqueSort = function( results ) {
	var elem,
		duplicates = [],
		j = 0,
		i = 0;

	// Unless we *know* we can detect duplicates, assume their presence
	hasDuplicate = !support.detectDuplicates;
	sortInput = !support.sortStable && results.slice( 0 );
	results.sort( sortOrder );

	if ( hasDuplicate ) {
		while ( (elem = results[i++]) ) {
			if ( elem === results[ i ] ) {
				j = duplicates.push( i );
			}
		}
		while ( j-- ) {
			results.splice( duplicates[ j ], 1 );
		}
	}

	// Clear input after sorting to release objects
	// See https://github.com/jquery/sizzle/pull/225
	sortInput = null;

	return results;
};

/**
 * Utility function for retrieving the text value of an array of DOM nodes
 * @param {Array|Element} elem
 */
getText = Sizzle.getText = function( elem ) {
	var node,
		ret = "",
		i = 0,
		nodeType = elem.nodeType;

	if ( !nodeType ) {
		// If no nodeType, this is expected to be an array
		while ( (node = elem[i++]) ) {
			// Do not traverse comment nodes
			ret += getText( node );
		}
	} else if ( nodeType === 1 || nodeType === 9 || nodeType === 11 ) {
		// Use textContent for elements
		// innerText usage removed for consistency of new lines (jQuery #11153)
		if ( typeof elem.textContent === "string" ) {
			return elem.textContent;
		} else {
			// Traverse its children
			for ( elem = elem.firstChild; elem; elem = elem.nextSibling ) {
				ret += getText( elem );
			}
		}
	} else if ( nodeType === 3 || nodeType === 4 ) {
		return elem.nodeValue;
	}
	// Do not include comment or processing instruction nodes

	return ret;
};

Expr = Sizzle.selectors = {

	// Can be adjusted by the user
	cacheLength: 50,

	createPseudo: markFunction,

	match: matchExpr,

	attrHandle: {},

	find: {},

	relative: {
		">": { dir: "parentNode", first: true },
		" ": { dir: "parentNode" },
		"+": { dir: "previousSibling", first: true },
		"~": { dir: "previousSibling" }
	},

	preFilter: {
		"ATTR": function( match ) {
			match[1] = match[1].replace( runescape, funescape );

			// Move the given value to match[3] whether quoted or unquoted
			match[3] = ( match[3] || match[4] || match[5] || "" ).replace( runescape, funescape );

			if ( match[2] === "~=" ) {
				match[3] = " " + match[3] + " ";
			}

			return match.slice( 0, 4 );
		},

		"CHILD": function( match ) {
			/* matches from matchExpr["CHILD"]
				1 type (only|nth|...)
				2 what (child|of-type)
				3 argument (even|odd|\d*|\d*n([+-]\d+)?|...)
				4 xn-component of xn+y argument ([+-]?\d*n|)
				5 sign of xn-component
				6 x of xn-component
				7 sign of y-component
				8 y of y-component
			*/
			match[1] = match[1].toLowerCase();

			if ( match[1].slice( 0, 3 ) === "nth" ) {
				// nth-* requires argument
				if ( !match[3] ) {
					Sizzle.error( match[0] );
				}

				// numeric x and y parameters for Expr.filter.CHILD
				// remember that false/true cast respectively to 0/1
				match[4] = +( match[4] ? match[5] + (match[6] || 1) : 2 * ( match[3] === "even" || match[3] === "odd" ) );
				match[5] = +( ( match[7] + match[8] ) || match[3] === "odd" );

			// other types prohibit arguments
			} else if ( match[3] ) {
				Sizzle.error( match[0] );
			}

			return match;
		},

		"PSEUDO": function( match ) {
			var excess,
				unquoted = !match[6] && match[2];

			if ( matchExpr["CHILD"].test( match[0] ) ) {
				return null;
			}

			// Accept quoted arguments as-is
			if ( match[3] ) {
				match[2] = match[4] || match[5] || "";

			// Strip excess characters from unquoted arguments
			} else if ( unquoted && rpseudo.test( unquoted ) &&
				// Get excess from tokenize (recursively)
				(excess = tokenize( unquoted, true )) &&
				// advance to the next closing parenthesis
				(excess = unquoted.indexOf( ")", unquoted.length - excess ) - unquoted.length) ) {

				// excess is a negative index
				match[0] = match[0].slice( 0, excess );
				match[2] = unquoted.slice( 0, excess );
			}

			// Return only captures needed by the pseudo filter method (type and argument)
			return match.slice( 0, 3 );
		}
	},

	filter: {

		"TAG": function( nodeNameSelector ) {
			var nodeName = nodeNameSelector.replace( runescape, funescape ).toLowerCase();
			return nodeNameSelector === "*" ?
				function() { return true; } :
				function( elem ) {
					return elem.nodeName && elem.nodeName.toLowerCase() === nodeName;
				};
		},

		"CLASS": function( className ) {
			var pattern = classCache[ className + " " ];

			return pattern ||
				(pattern = new RegExp( "(^|" + whitespace + ")" + className + "(" + whitespace + "|$)" )) &&
				classCache( className, function( elem ) {
					return pattern.test( typeof elem.className === "string" && elem.className || typeof elem.getAttribute !== strundefined && elem.getAttribute("class") || "" );
				});
		},

		"ATTR": function( name, operator, check ) {
			return function( elem ) {
				var result = Sizzle.attr( elem, name );

				if ( result == null ) {
					return operator === "!=";
				}
				if ( !operator ) {
					return true;
				}

				result += "";

				return operator === "=" ? result === check :
					operator === "!=" ? result !== check :
					operator === "^=" ? check && result.indexOf( check ) === 0 :
					operator === "*=" ? check && result.indexOf( check ) > -1 :
					operator === "$=" ? check && result.slice( -check.length ) === check :
					operator === "~=" ? ( " " + result + " " ).indexOf( check ) > -1 :
					operator === "|=" ? result === check || result.slice( 0, check.length + 1 ) === check + "-" :
					false;
			};
		},

		"CHILD": function( type, what, argument, first, last ) {
			var simple = type.slice( 0, 3 ) !== "nth",
				forward = type.slice( -4 ) !== "last",
				ofType = what === "of-type";

			return first === 1 && last === 0 ?

				// Shortcut for :nth-*(n)
				function( elem ) {
					return !!elem.parentNode;
				} :

				function( elem, context, xml ) {
					var cache, outerCache, node, diff, nodeIndex, start,
						dir = simple !== forward ? "nextSibling" : "previousSibling",
						parent = elem.parentNode,
						name = ofType && elem.nodeName.toLowerCase(),
						useCache = !xml && !ofType;

					if ( parent ) {

						// :(first|last|only)-(child|of-type)
						if ( simple ) {
							while ( dir ) {
								node = elem;
								while ( (node = node[ dir ]) ) {
									if ( ofType ? node.nodeName.toLowerCase() === name : node.nodeType === 1 ) {
										return false;
									}
								}
								// Reverse direction for :only-* (if we haven't yet done so)
								start = dir = type === "only" && !start && "nextSibling";
							}
							return true;
						}

						start = [ forward ? parent.firstChild : parent.lastChild ];

						// non-xml :nth-child(...) stores cache data on `parent`
						if ( forward && useCache ) {
							// Seek `elem` from a previously-cached index
							outerCache = parent[ expando ] || (parent[ expando ] = {});
							cache = outerCache[ type ] || [];
							nodeIndex = cache[0] === dirruns && cache[1];
							diff = cache[0] === dirruns && cache[2];
							node = nodeIndex && parent.childNodes[ nodeIndex ];

							while ( (node = ++nodeIndex && node && node[ dir ] ||

								// Fallback to seeking `elem` from the start
								(diff = nodeIndex = 0) || start.pop()) ) {

								// When found, cache indexes on `parent` and break
								if ( node.nodeType === 1 && ++diff && node === elem ) {
									outerCache[ type ] = [ dirruns, nodeIndex, diff ];
									break;
								}
							}

						// Use previously-cached element index if available
						} else if ( useCache && (cache = (elem[ expando ] || (elem[ expando ] = {}))[ type ]) && cache[0] === dirruns ) {
							diff = cache[1];

						// xml :nth-child(...) or :nth-last-child(...) or :nth(-last)?-of-type(...)
						} else {
							// Use the same loop as above to seek `elem` from the start
							while ( (node = ++nodeIndex && node && node[ dir ] ||
								(diff = nodeIndex = 0) || start.pop()) ) {

								if ( ( ofType ? node.nodeName.toLowerCase() === name : node.nodeType === 1 ) && ++diff ) {
									// Cache the index of each encountered element
									if ( useCache ) {
										(node[ expando ] || (node[ expando ] = {}))[ type ] = [ dirruns, diff ];
									}

									if ( node === elem ) {
										break;
									}
								}
							}
						}

						// Incorporate the offset, then check against cycle size
						diff -= last;
						return diff === first || ( diff % first === 0 && diff / first >= 0 );
					}
				};
		},

		"PSEUDO": function( pseudo, argument ) {
			// pseudo-class names are case-insensitive
			// http://www.w3.org/TR/selectors/#pseudo-classes
			// Prioritize by case sensitivity in case custom pseudos are added with uppercase letters
			// Remember that setFilters inherits from pseudos
			var args,
				fn = Expr.pseudos[ pseudo ] || Expr.setFilters[ pseudo.toLowerCase() ] ||
					Sizzle.error( "unsupported pseudo: " + pseudo );

			// The user may use createPseudo to indicate that
			// arguments are needed to create the filter function
			// just as Sizzle does
			if ( fn[ expando ] ) {
				return fn( argument );
			}

			// But maintain support for old signatures
			if ( fn.length > 1 ) {
				args = [ pseudo, pseudo, "", argument ];
				return Expr.setFilters.hasOwnProperty( pseudo.toLowerCase() ) ?
					markFunction(function( seed, matches ) {
						var idx,
							matched = fn( seed, argument ),
							i = matched.length;
						while ( i-- ) {
							idx = indexOf.call( seed, matched[i] );
							seed[ idx ] = !( matches[ idx ] = matched[i] );
						}
					}) :
					function( elem ) {
						return fn( elem, 0, args );
					};
			}

			return fn;
		}
	},

	pseudos: {
		// Potentially complex pseudos
		"not": markFunction(function( selector ) {
			// Trim the selector passed to compile
			// to avoid treating leading and trailing
			// spaces as combinators
			var input = [],
				results = [],
				matcher = compile( selector.replace( rtrim, "$1" ) );

			return matcher[ expando ] ?
				markFunction(function( seed, matches, context, xml ) {
					var elem,
						unmatched = matcher( seed, null, xml, [] ),
						i = seed.length;

					// Match elements unmatched by `matcher`
					while ( i-- ) {
						if ( (elem = unmatched[i]) ) {
							seed[i] = !(matches[i] = elem);
						}
					}
				}) :
				function( elem, context, xml ) {
					input[0] = elem;
					matcher( input, null, xml, results );
					return !results.pop();
				};
		}),

		"has": markFunction(function( selector ) {
			return function( elem ) {
				return Sizzle( selector, elem ).length > 0;
			};
		}),

		"contains": markFunction(function( text ) {
			return function( elem ) {
				return ( elem.textContent || elem.innerText || getText( elem ) ).indexOf( text ) > -1;
			};
		}),

		// "Whether an element is represented by a :lang() selector
		// is based solely on the element's language value
		// being equal to the identifier C,
		// or beginning with the identifier C immediately followed by "-".
		// The matching of C against the element's language value is performed case-insensitively.
		// The identifier C does not have to be a valid language name."
		// http://www.w3.org/TR/selectors/#lang-pseudo
		"lang": markFunction( function( lang ) {
			// lang value must be a valid identifier
			if ( !ridentifier.test(lang || "") ) {
				Sizzle.error( "unsupported lang: " + lang );
			}
			lang = lang.replace( runescape, funescape ).toLowerCase();
			return function( elem ) {
				var elemLang;
				do {
					if ( (elemLang = documentIsHTML ?
						elem.lang :
						elem.getAttribute("xml:lang") || elem.getAttribute("lang")) ) {

						elemLang = elemLang.toLowerCase();
						return elemLang === lang || elemLang.indexOf( lang + "-" ) === 0;
					}
				} while ( (elem = elem.parentNode) && elem.nodeType === 1 );
				return false;
			};
		}),

		// Miscellaneous
		"target": function( elem ) {
			var hash = window.location && window.location.hash;
			return hash && hash.slice( 1 ) === elem.id;
		},

		"root": function( elem ) {
			return elem === docElem;
		},

		"focus": function( elem ) {
			return elem === document.activeElement && (!document.hasFocus || document.hasFocus()) && !!(elem.type || elem.href || ~elem.tabIndex);
		},

		// Boolean properties
		"enabled": function( elem ) {
			return elem.disabled === false;
		},

		"disabled": function( elem ) {
			return elem.disabled === true;
		},

		"checked": function( elem ) {
			// In CSS3, :checked should return both checked and selected elements
			// http://www.w3.org/TR/2011/REC-css3-selectors-20110929/#checked
			var nodeName = elem.nodeName.toLowerCase();
			return (nodeName === "input" && !!elem.checked) || (nodeName === "option" && !!elem.selected);
		},

		"selected": function( elem ) {
			// Accessing this property makes selected-by-default
			// options in Safari work properly
			if ( elem.parentNode ) {
				elem.parentNode.selectedIndex;
			}

			return elem.selected === true;
		},

		// Contents
		"empty": function( elem ) {
			// http://www.w3.org/TR/selectors/#empty-pseudo
			// :empty is negated by element (1) or content nodes (text: 3; cdata: 4; entity ref: 5),
			//   but not by others (comment: 8; processing instruction: 7; etc.)
			// nodeType < 6 works because attributes (2) do not appear as children
			for ( elem = elem.firstChild; elem; elem = elem.nextSibling ) {
				if ( elem.nodeType < 6 ) {
					return false;
				}
			}
			return true;
		},

		"parent": function( elem ) {
			return !Expr.pseudos["empty"]( elem );
		},

		// Element/input types
		"header": function( elem ) {
			return rheader.test( elem.nodeName );
		},

		"input": function( elem ) {
			return rinputs.test( elem.nodeName );
		},

		"button": function( elem ) {
			var name = elem.nodeName.toLowerCase();
			return name === "input" && elem.type === "button" || name === "button";
		},

		"text": function( elem ) {
			var attr;
			return elem.nodeName.toLowerCase() === "input" &&
				elem.type === "text" &&

				// Support: IE<8
				// New HTML5 attribute values (e.g., "search") appear with elem.type === "text"
				( (attr = elem.getAttribute("type")) == null || attr.toLowerCase() === "text" );
		},

		// Position-in-collection
		"first": createPositionalPseudo(function() {
			return [ 0 ];
		}),

		"last": createPositionalPseudo(function( matchIndexes, length ) {
			return [ length - 1 ];
		}),

		"eq": createPositionalPseudo(function( matchIndexes, length, argument ) {
			return [ argument < 0 ? argument + length : argument ];
		}),

		"even": createPositionalPseudo(function( matchIndexes, length ) {
			var i = 0;
			for ( ; i < length; i += 2 ) {
				matchIndexes.push( i );
			}
			return matchIndexes;
		}),

		"odd": createPositionalPseudo(function( matchIndexes, length ) {
			var i = 1;
			for ( ; i < length; i += 2 ) {
				matchIndexes.push( i );
			}
			return matchIndexes;
		}),

		"lt": createPositionalPseudo(function( matchIndexes, length, argument ) {
			var i = argument < 0 ? argument + length : argument;
			for ( ; --i >= 0; ) {
				matchIndexes.push( i );
			}
			return matchIndexes;
		}),

		"gt": createPositionalPseudo(function( matchIndexes, length, argument ) {
			var i = argument < 0 ? argument + length : argument;
			for ( ; ++i < length; ) {
				matchIndexes.push( i );
			}
			return matchIndexes;
		})
	}
};

Expr.pseudos["nth"] = Expr.pseudos["eq"];

// Add button/input type pseudos
for ( i in { radio: true, checkbox: true, file: true, password: true, image: true } ) {
	Expr.pseudos[ i ] = createInputPseudo( i );
}
for ( i in { submit: true, reset: true } ) {
	Expr.pseudos[ i ] = createButtonPseudo( i );
}

// Easy API for creating new setFilters
function setFilters() {}
setFilters.prototype = Expr.filters = Expr.pseudos;
Expr.setFilters = new setFilters();

tokenize = Sizzle.tokenize = function( selector, parseOnly ) {
	var matched, match, tokens, type,
		soFar, groups, preFilters,
		cached = tokenCache[ selector + " " ];

	if ( cached ) {
		return parseOnly ? 0 : cached.slice( 0 );
	}

	soFar = selector;
	groups = [];
	preFilters = Expr.preFilter;

	while ( soFar ) {

		// Comma and first run
		if ( !matched || (match = rcomma.exec( soFar )) ) {
			if ( match ) {
				// Don't consume trailing commas as valid
				soFar = soFar.slice( match[0].length ) || soFar;
			}
			groups.push( (tokens = []) );
		}

		matched = false;

		// Combinators
		if ( (match = rcombinators.exec( soFar )) ) {
			matched = match.shift();
			tokens.push({
				value: matched,
				// Cast descendant combinators to space
				type: match[0].replace( rtrim, " " )
			});
			soFar = soFar.slice( matched.length );
		}

		// Filters
		for ( type in Expr.filter ) {
			if ( (match = matchExpr[ type ].exec( soFar )) && (!preFilters[ type ] ||
				(match = preFilters[ type ]( match ))) ) {
				matched = match.shift();
				tokens.push({
					value: matched,
					type: type,
					matches: match
				});
				soFar = soFar.slice( matched.length );
			}
		}

		if ( !matched ) {
			break;
		}
	}

	// Return the length of the invalid excess
	// if we're just parsing
	// Otherwise, throw an error or return tokens
	return parseOnly ?
		soFar.length :
		soFar ?
			Sizzle.error( selector ) :
			// Cache the tokens
			tokenCache( selector, groups ).slice( 0 );
};

function toSelector( tokens ) {
	var i = 0,
		len = tokens.length,
		selector = "";
	for ( ; i < len; i++ ) {
		selector += tokens[i].value;
	}
	return selector;
}

function addCombinator( matcher, combinator, base ) {
	var dir = combinator.dir,
		checkNonElements = base && dir === "parentNode",
		doneName = done++;

	return combinator.first ?
		// Check against closest ancestor/preceding element
		function( elem, context, xml ) {
			while ( (elem = elem[ dir ]) ) {
				if ( elem.nodeType === 1 || checkNonElements ) {
					return matcher( elem, context, xml );
				}
			}
		} :

		// Check against all ancestor/preceding elements
		function( elem, context, xml ) {
			var oldCache, outerCache,
				newCache = [ dirruns, doneName ];

			// We can't set arbitrary data on XML nodes, so they don't benefit from dir caching
			if ( xml ) {
				while ( (elem = elem[ dir ]) ) {
					if ( elem.nodeType === 1 || checkNonElements ) {
						if ( matcher( elem, context, xml ) ) {
							return true;
						}
					}
				}
			} else {
				while ( (elem = elem[ dir ]) ) {
					if ( elem.nodeType === 1 || checkNonElements ) {
						outerCache = elem[ expando ] || (elem[ expando ] = {});
						if ( (oldCache = outerCache[ dir ]) &&
							oldCache[ 0 ] === dirruns && oldCache[ 1 ] === doneName ) {

							// Assign to newCache so results back-propagate to previous elements
							return (newCache[ 2 ] = oldCache[ 2 ]);
						} else {
							// Reuse newcache so results back-propagate to previous elements
							outerCache[ dir ] = newCache;

							// A match means we're done; a fail means we have to keep checking
							if ( (newCache[ 2 ] = matcher( elem, context, xml )) ) {
								return true;
							}
						}
					}
				}
			}
		};
}

function elementMatcher( matchers ) {
	return matchers.length > 1 ?
		function( elem, context, xml ) {
			var i = matchers.length;
			while ( i-- ) {
				if ( !matchers[i]( elem, context, xml ) ) {
					return false;
				}
			}
			return true;
		} :
		matchers[0];
}

function multipleContexts( selector, contexts, results ) {
	var i = 0,
		len = contexts.length;
	for ( ; i < len; i++ ) {
		Sizzle( selector, contexts[i], results );
	}
	return results;
}

function condense( unmatched, map, filter, context, xml ) {
	var elem,
		newUnmatched = [],
		i = 0,
		len = unmatched.length,
		mapped = map != null;

	for ( ; i < len; i++ ) {
		if ( (elem = unmatched[i]) ) {
			if ( !filter || filter( elem, context, xml ) ) {
				newUnmatched.push( elem );
				if ( mapped ) {
					map.push( i );
				}
			}
		}
	}

	return newUnmatched;
}

function setMatcher( preFilter, selector, matcher, postFilter, postFinder, postSelector ) {
	if ( postFilter && !postFilter[ expando ] ) {
		postFilter = setMatcher( postFilter );
	}
	if ( postFinder && !postFinder[ expando ] ) {
		postFinder = setMatcher( postFinder, postSelector );
	}
	return markFunction(function( seed, results, context, xml ) {
		var temp, i, elem,
			preMap = [],
			postMap = [],
			preexisting = results.length,

			// Get initial elements from seed or context
			elems = seed || multipleContexts( selector || "*", context.nodeType ? [ context ] : context, [] ),

			// Prefilter to get matcher input, preserving a map for seed-results synchronization
			matcherIn = preFilter && ( seed || !selector ) ?
				condense( elems, preMap, preFilter, context, xml ) :
				elems,

			matcherOut = matcher ?
				// If we have a postFinder, or filtered seed, or non-seed postFilter or preexisting results,
				postFinder || ( seed ? preFilter : preexisting || postFilter ) ?

					// ...intermediate processing is necessary
					[] :

					// ...otherwise use results directly
					results :
				matcherIn;

		// Find primary matches
		if ( matcher ) {
			matcher( matcherIn, matcherOut, context, xml );
		}

		// Apply postFilter
		if ( postFilter ) {
			temp = condense( matcherOut, postMap );
			postFilter( temp, [], context, xml );

			// Un-match failing elements by moving them back to matcherIn
			i = temp.length;
			while ( i-- ) {
				if ( (elem = temp[i]) ) {
					matcherOut[ postMap[i] ] = !(matcherIn[ postMap[i] ] = elem);
				}
			}
		}

		if ( seed ) {
			if ( postFinder || preFilter ) {
				if ( postFinder ) {
					// Get the final matcherOut by condensing this intermediate into postFinder contexts
					temp = [];
					i = matcherOut.length;
					while ( i-- ) {
						if ( (elem = matcherOut[i]) ) {
							// Restore matcherIn since elem is not yet a final match
							temp.push( (matcherIn[i] = elem) );
						}
					}
					postFinder( null, (matcherOut = []), temp, xml );
				}

				// Move matched elements from seed to results to keep them synchronized
				i = matcherOut.length;
				while ( i-- ) {
					if ( (elem = matcherOut[i]) &&
						(temp = postFinder ? indexOf.call( seed, elem ) : preMap[i]) > -1 ) {

						seed[temp] = !(results[temp] = elem);
					}
				}
			}

		// Add elements to results, through postFinder if defined
		} else {
			matcherOut = condense(
				matcherOut === results ?
					matcherOut.splice( preexisting, matcherOut.length ) :
					matcherOut
			);
			if ( postFinder ) {
				postFinder( null, results, matcherOut, xml );
			} else {
				push.apply( results, matcherOut );
			}
		}
	});
}

function matcherFromTokens( tokens ) {
	var checkContext, matcher, j,
		len = tokens.length,
		leadingRelative = Expr.relative[ tokens[0].type ],
		implicitRelative = leadingRelative || Expr.relative[" "],
		i = leadingRelative ? 1 : 0,

		// The foundational matcher ensures that elements are reachable from top-level context(s)
		matchContext = addCombinator( function( elem ) {
			return elem === checkContext;
		}, implicitRelative, true ),
		matchAnyContext = addCombinator( function( elem ) {
			return indexOf.call( checkContext, elem ) > -1;
		}, implicitRelative, true ),
		matchers = [ function( elem, context, xml ) {
			return ( !leadingRelative && ( xml || context !== outermostContext ) ) || (
				(checkContext = context).nodeType ?
					matchContext( elem, context, xml ) :
					matchAnyContext( elem, context, xml ) );
		} ];

	for ( ; i < len; i++ ) {
		if ( (matcher = Expr.relative[ tokens[i].type ]) ) {
			matchers = [ addCombinator(elementMatcher( matchers ), matcher) ];
		} else {
			matcher = Expr.filter[ tokens[i].type ].apply( null, tokens[i].matches );

			// Return special upon seeing a positional matcher
			if ( matcher[ expando ] ) {
				// Find the next relative operator (if any) for proper handling
				j = ++i;
				for ( ; j < len; j++ ) {
					if ( Expr.relative[ tokens[j].type ] ) {
						break;
					}
				}
				return setMatcher(
					i > 1 && elementMatcher( matchers ),
					i > 1 && toSelector(
						// If the preceding token was a descendant combinator, insert an implicit any-element `*`
						tokens.slice( 0, i - 1 ).concat({ value: tokens[ i - 2 ].type === " " ? "*" : "" })
					).replace( rtrim, "$1" ),
					matcher,
					i < j && matcherFromTokens( tokens.slice( i, j ) ),
					j < len && matcherFromTokens( (tokens = tokens.slice( j )) ),
					j < len && toSelector( tokens )
				);
			}
			matchers.push( matcher );
		}
	}

	return elementMatcher( matchers );
}

function matcherFromGroupMatchers( elementMatchers, setMatchers ) {
	var bySet = setMatchers.length > 0,
		byElement = elementMatchers.length > 0,
		superMatcher = function( seed, context, xml, results, outermost ) {
			var elem, j, matcher,
				matchedCount = 0,
				i = "0",
				unmatched = seed && [],
				setMatched = [],
				contextBackup = outermostContext,
				// We must always have either seed elements or outermost context
				elems = seed || byElement && Expr.find["TAG"]( "*", outermost ),
				// Use integer dirruns iff this is the outermost matcher
				dirrunsUnique = (dirruns += contextBackup == null ? 1 : Math.random() || 0.1),
				len = elems.length;

			if ( outermost ) {
				outermostContext = context !== document && context;
			}

			// Add elements passing elementMatchers directly to results
			// Keep `i` a string if there are no elements so `matchedCount` will be "00" below
			// Support: IE<9, Safari
			// Tolerate NodeList properties (IE: "length"; Safari: <number>) matching elements by id
			for ( ; i !== len && (elem = elems[i]) != null; i++ ) {
				if ( byElement && elem ) {
					j = 0;
					while ( (matcher = elementMatchers[j++]) ) {
						if ( matcher( elem, context, xml ) ) {
							results.push( elem );
							break;
						}
					}
					if ( outermost ) {
						dirruns = dirrunsUnique;
					}
				}

				// Track unmatched elements for set filters
				if ( bySet ) {
					// They will have gone through all possible matchers
					if ( (elem = !matcher && elem) ) {
						matchedCount--;
					}

					// Lengthen the array for every element, matched or not
					if ( seed ) {
						unmatched.push( elem );
					}
				}
			}

			// Apply set filters to unmatched elements
			matchedCount += i;
			if ( bySet && i !== matchedCount ) {
				j = 0;
				while ( (matcher = setMatchers[j++]) ) {
					matcher( unmatched, setMatched, context, xml );
				}

				if ( seed ) {
					// Reintegrate element matches to eliminate the need for sorting
					if ( matchedCount > 0 ) {
						while ( i-- ) {
							if ( !(unmatched[i] || setMatched[i]) ) {
								setMatched[i] = pop.call( results );
							}
						}
					}

					// Discard index placeholder values to get only actual matches
					setMatched = condense( setMatched );
				}

				// Add matches to results
				push.apply( results, setMatched );

				// Seedless set matches succeeding multiple successful matchers stipulate sorting
				if ( outermost && !seed && setMatched.length > 0 &&
					( matchedCount + setMatchers.length ) > 1 ) {

					Sizzle.uniqueSort( results );
				}
			}

			// Override manipulation of globals by nested matchers
			if ( outermost ) {
				dirruns = dirrunsUnique;
				outermostContext = contextBackup;
			}

			return unmatched;
		};

	return bySet ?
		markFunction( superMatcher ) :
		superMatcher;
}

compile = Sizzle.compile = function( selector, match /* Internal Use Only */ ) {
	var i,
		setMatchers = [],
		elementMatchers = [],
		cached = compilerCache[ selector + " " ];

	if ( !cached ) {
		// Generate a function of recursive functions that can be used to check each element
		if ( !match ) {
			match = tokenize( selector );
		}
		i = match.length;
		while ( i-- ) {
			cached = matcherFromTokens( match[i] );
			if ( cached[ expando ] ) {
				setMatchers.push( cached );
			} else {
				elementMatchers.push( cached );
			}
		}

		// Cache the compiled function
		cached = compilerCache( selector, matcherFromGroupMatchers( elementMatchers, setMatchers ) );

		// Save selector and tokenization
		cached.selector = selector;
	}
	return cached;
};

/**
 * A low-level selection function that works with Sizzle's compiled
 *  selector functions
 * @param {String|Function} selector A selector or a pre-compiled
 *  selector function built with Sizzle.compile
 * @param {Element} context
 * @param {Array} [results]
 * @param {Array} [seed] A set of elements to match against
 */
select = Sizzle.select = function( selector, context, results, seed ) {
	var i, tokens, token, type, find,
		compiled = typeof selector === "function" && selector,
		match = !seed && tokenize( (selector = compiled.selector || selector) );

	results = results || [];

	// Try to minimize operations if there is no seed and only one group
	if ( match.length === 1 ) {

		// Take a shortcut and set the context if the root selector is an ID
		tokens = match[0] = match[0].slice( 0 );
		if ( tokens.length > 2 && (token = tokens[0]).type === "ID" &&
				support.getById && context.nodeType === 9 && documentIsHTML &&
				Expr.relative[ tokens[1].type ] ) {

			context = ( Expr.find["ID"]( token.matches[0].replace(runescape, funescape), context ) || [] )[0];
			if ( !context ) {
				return results;

			// Precompiled matchers will still verify ancestry, so step up a level
			} else if ( compiled ) {
				context = context.parentNode;
			}

			selector = selector.slice( tokens.shift().value.length );
		}

		// Fetch a seed set for right-to-left matching
		i = matchExpr["needsContext"].test( selector ) ? 0 : tokens.length;
		while ( i-- ) {
			token = tokens[i];

			// Abort if we hit a combinator
			if ( Expr.relative[ (type = token.type) ] ) {
				break;
			}
			if ( (find = Expr.find[ type ]) ) {
				// Search, expanding context for leading sibling combinators
				if ( (seed = find(
					token.matches[0].replace( runescape, funescape ),
					rsibling.test( tokens[0].type ) && testContext( context.parentNode ) || context
				)) ) {

					// If seed is empty or no tokens remain, we can return early
					tokens.splice( i, 1 );
					selector = seed.length && toSelector( tokens );
					if ( !selector ) {
						push.apply( results, seed );
						return results;
					}

					break;
				}
			}
		}
	}

	// Compile and execute a filtering function if one is not provided
	// Provide `match` to avoid retokenization if we modified the selector above
	( compiled || compile( selector, match ) )(
		seed,
		context,
		!documentIsHTML,
		results,
		rsibling.test( selector ) && testContext( context.parentNode ) || context
	);
	return results;
};

// One-time assignments

// Sort stability
support.sortStable = expando.split("").sort( sortOrder ).join("") === expando;

// Support: Chrome<14
// Always assume duplicates if they aren't passed to the comparison function
support.detectDuplicates = !!hasDuplicate;

// Initialize against the default document
setDocument();

// Support: Webkit<537.32 - Safari 6.0.3/Chrome 25 (fixed in Chrome 27)
// Detached nodes confoundingly follow *each other*
support.sortDetached = assert(function( div1 ) {
	// Should return 1, but returns 4 (following)
	return div1.compareDocumentPosition( document.createElement("div") ) & 1;
});

// Support: IE<8
// Prevent attribute/property "interpolation"
// http://msdn.microsoft.com/en-us/library/ms536429%28VS.85%29.aspx
if ( !assert(function( div ) {
	div.innerHTML = "<a href='#'></a>";
	return div.firstChild.getAttribute("href") === "#" ;
}) ) {
	addHandle( "type|href|height|width", function( elem, name, isXML ) {
		if ( !isXML ) {
			return elem.getAttribute( name, name.toLowerCase() === "type" ? 1 : 2 );
		}
	});
}

// Support: IE<9
// Use defaultValue in place of getAttribute("value")
if ( !support.attributes || !assert(function( div ) {
	div.innerHTML = "<input/>";
	div.firstChild.setAttribute( "value", "" );
	return div.firstChild.getAttribute( "value" ) === "";
}) ) {
	addHandle( "value", function( elem, name, isXML ) {
		if ( !isXML && elem.nodeName.toLowerCase() === "input" ) {
			return elem.defaultValue;
		}
	});
}

// Support: IE<9
// Use getAttributeNode to fetch booleans when getAttribute lies
if ( !assert(function( div ) {
	return div.getAttribute("disabled") == null;
}) ) {
	addHandle( booleans, function( elem, name, isXML ) {
		var val;
		if ( !isXML ) {
			return elem[ name ] === true ? name.toLowerCase() :
					(val = elem.getAttributeNode( name )) && val.specified ?
					val.value :
				null;
		}
	});
}

return Sizzle;

})( window );



jQuery.find = Sizzle;
jQuery.expr = Sizzle.selectors;
jQuery.expr[":"] = jQuery.expr.pseudos;
jQuery.unique = Sizzle.uniqueSort;
jQuery.text = Sizzle.getText;
jQuery.isXMLDoc = Sizzle.isXML;
jQuery.contains = Sizzle.contains;



var rneedsContext = jQuery.expr.match.needsContext;

var rsingleTag = (/^<(\w+)\s*\/?>(?:<\/\1>|)$/);



var risSimple = /^.[^:#\[\.,]*$/;

// Implement the identical functionality for filter and not
function winnow( elements, qualifier, not ) {
	if ( jQuery.isFunction( qualifier ) ) {
		return jQuery.grep( elements, function( elem, i ) {
			/* jshint -W018 */
			return !!qualifier.call( elem, i, elem ) !== not;
		});

	}

	if ( qualifier.nodeType ) {
		return jQuery.grep( elements, function( elem ) {
			return ( elem === qualifier ) !== not;
		});

	}

	if ( typeof qualifier === "string" ) {
		if ( risSimple.test( qualifier ) ) {
			return jQuery.filter( qualifier, elements, not );
		}

		qualifier = jQuery.filter( qualifier, elements );
	}

	return jQuery.grep( elements, function( elem ) {
		return ( indexOf.call( qualifier, elem ) >= 0 ) !== not;
	});
}

jQuery.filter = function( expr, elems, not ) {
	var elem = elems[ 0 ];

	if ( not ) {
		expr = ":not(" + expr + ")";
	}

	return elems.length === 1 && elem.nodeType === 1 ?
		jQuery.find.matchesSelector( elem, expr ) ? [ elem ] : [] :
		jQuery.find.matches( expr, jQuery.grep( elems, function( elem ) {
			return elem.nodeType === 1;
		}));
};

jQuery.fn.extend({
	find: function( selector ) {
		var i,
			len = this.length,
			ret = [],
			self = this;

		if ( typeof selector !== "string" ) {
			return this.pushStack( jQuery( selector ).filter(function() {
				for ( i = 0; i < len; i++ ) {
					if ( jQuery.contains( self[ i ], this ) ) {
						return true;
					}
				}
			}) );
		}

		for ( i = 0; i < len; i++ ) {
			jQuery.find( selector, self[ i ], ret );
		}

		// Needed because $( selector, context ) becomes $( context ).find( selector )
		ret = this.pushStack( len > 1 ? jQuery.unique( ret ) : ret );
		ret.selector = this.selector ? this.selector + " " + selector : selector;
		return ret;
	},
	filter: function( selector ) {
		return this.pushStack( winnow(this, selector || [], false) );
	},
	not: function( selector ) {
		return this.pushStack( winnow(this, selector || [], true) );
	},
	is: function( selector ) {
		return !!winnow(
			this,

			// If this is a positional/relative selector, check membership in the returned set
			// so $("p:first").is("p:last") won't return true for a doc with two "p".
			typeof selector === "string" && rneedsContext.test( selector ) ?
				jQuery( selector ) :
				selector || [],
			false
		).length;
	}
});


// Initialize a jQuery object


// A central reference to the root jQuery(document)
var rootjQuery,

	// A simple way to check for HTML strings
	// Prioritize #id over <tag> to avoid XSS via location.hash (#9521)
	// Strict HTML recognition (#11290: must start with <)
	rquickExpr = /^(?:\s*(<[\w\W]+>)[^>]*|#([\w-]*))$/,

	init = jQuery.fn.init = function( selector, context ) {
		var match, elem;

		// HANDLE: $(""), $(null), $(undefined), $(false)
		if ( !selector ) {
			return this;
		}

		// Handle HTML strings
		if ( typeof selector === "string" ) {
			if ( selector[0] === "<" && selector[ selector.length - 1 ] === ">" && selector.length >= 3 ) {
				// Assume that strings that start and end with <> are HTML and skip the regex check
				match = [ null, selector, null ];

			} else {
				match = rquickExpr.exec( selector );
			}

			// Match html or make sure no context is specified for #id
			if ( match && (match[1] || !context) ) {

				// HANDLE: $(html) -> $(array)
				if ( match[1] ) {
					context = context instanceof jQuery ? context[0] : context;

					// scripts is true for back-compat
					// Intentionally let the error be thrown if parseHTML is not present
					jQuery.merge( this, jQuery.parseHTML(
						match[1],
						context && context.nodeType ? context.ownerDocument || context : document,
						true
					) );

					// HANDLE: $(html, props)
					if ( rsingleTag.test( match[1] ) && jQuery.isPlainObject( context ) ) {
						for ( match in context ) {
							// Properties of context are called as methods if possible
							if ( jQuery.isFunction( this[ match ] ) ) {
								this[ match ]( context[ match ] );

							// ...and otherwise set as attributes
							} else {
								this.attr( match, context[ match ] );
							}
						}
					}

					return this;

				// HANDLE: $(#id)
				} else {
					elem = document.getElementById( match[2] );

					// Check parentNode to catch when Blackberry 4.6 returns
					// nodes that are no longer in the document #6963
					if ( elem && elem.parentNode ) {
						// Inject the element directly into the jQuery object
						this.length = 1;
						this[0] = elem;
					}

					this.context = document;
					this.selector = selector;
					return this;
				}

			// HANDLE: $(expr, $(...))
			} else if ( !context || context.jquery ) {
				return ( context || rootjQuery ).find( selector );

			// HANDLE: $(expr, context)
			// (which is just equivalent to: $(context).find(expr)
			} else {
				return this.constructor( context ).find( selector );
			}

		// HANDLE: $(DOMElement)
		} else if ( selector.nodeType ) {
			this.context = this[0] = selector;
			this.length = 1;
			return this;

		// HANDLE: $(function)
		// Shortcut for document ready
		} else if ( jQuery.isFunction( selector ) ) {
			return typeof rootjQuery.ready !== "undefined" ?
				rootjQuery.ready( selector ) :
				// Execute immediately if ready is not present
				selector( jQuery );
		}

		if ( selector.selector !== undefined ) {
			this.selector = selector.selector;
			this.context = selector.context;
		}

		return jQuery.makeArray( selector, this );
	};

// Give the init function the jQuery prototype for later instantiation
init.prototype = jQuery.fn;

// Initialize central reference
rootjQuery = jQuery( document );


var rparentsprev = /^(?:parents|prev(?:Until|All))/,
	// methods guaranteed to produce a unique set when starting from a unique set
	guaranteedUnique = {
		children: true,
		contents: true,
		next: true,
		prev: true
	};

jQuery.extend({
	dir: function( elem, dir, until ) {
		var matched = [],
			truncate = until !== undefined;

		while ( (elem = elem[ dir ]) && elem.nodeType !== 9 ) {
			if ( elem.nodeType === 1 ) {
				if ( truncate && jQuery( elem ).is( until ) ) {
					break;
				}
				matched.push( elem );
			}
		}
		return matched;
	},

	sibling: function( n, elem ) {
		var matched = [];

		for ( ; n; n = n.nextSibling ) {
			if ( n.nodeType === 1 && n !== elem ) {
				matched.push( n );
			}
		}

		return matched;
	}
});

jQuery.fn.extend({
	has: function( target ) {
		var targets = jQuery( target, this ),
			l = targets.length;

		return this.filter(function() {
			var i = 0;
			for ( ; i < l; i++ ) {
				if ( jQuery.contains( this, targets[i] ) ) {
					return true;
				}
			}
		});
	},

	closest: function( selectors, context ) {
		var cur,
			i = 0,
			l = this.length,
			matched = [],
			pos = rneedsContext.test( selectors ) || typeof selectors !== "string" ?
				jQuery( selectors, context || this.context ) :
				0;

		for ( ; i < l; i++ ) {
			for ( cur = this[i]; cur && cur !== context; cur = cur.parentNode ) {
				// Always skip document fragments
				if ( cur.nodeType < 11 && (pos ?
					pos.index(cur) > -1 :

					// Don't pass non-elements to Sizzle
					cur.nodeType === 1 &&
						jQuery.find.matchesSelector(cur, selectors)) ) {

					matched.push( cur );
					break;
				}
			}
		}

		return this.pushStack( matched.length > 1 ? jQuery.unique( matched ) : matched );
	},

	// Determine the position of an element within
	// the matched set of elements
	index: function( elem ) {

		// No argument, return index in parent
		if ( !elem ) {
			return ( this[ 0 ] && this[ 0 ].parentNode ) ? this.first().prevAll().length : -1;
		}

		// index in selector
		if ( typeof elem === "string" ) {
			return indexOf.call( jQuery( elem ), this[ 0 ] );
		}

		// Locate the position of the desired element
		return indexOf.call( this,

			// If it receives a jQuery object, the first element is used
			elem.jquery ? elem[ 0 ] : elem
		);
	},

	add: function( selector, context ) {
		return this.pushStack(
			jQuery.unique(
				jQuery.merge( this.get(), jQuery( selector, context ) )
			)
		);
	},

	addBack: function( selector ) {
		return this.add( selector == null ?
			this.prevObject : this.prevObject.filter(selector)
		);
	}
});

function sibling( cur, dir ) {
	while ( (cur = cur[dir]) && cur.nodeType !== 1 ) {}
	return cur;
}

jQuery.each({
	parent: function( elem ) {
		var parent = elem.parentNode;
		return parent && parent.nodeType !== 11 ? parent : null;
	},
	parents: function( elem ) {
		return jQuery.dir( elem, "parentNode" );
	},
	parentsUntil: function( elem, i, until ) {
		return jQuery.dir( elem, "parentNode", until );
	},
	next: function( elem ) {
		return sibling( elem, "nextSibling" );
	},
	prev: function( elem ) {
		return sibling( elem, "previousSibling" );
	},
	nextAll: function( elem ) {
		return jQuery.dir( elem, "nextSibling" );
	},
	prevAll: function( elem ) {
		return jQuery.dir( elem, "previousSibling" );
	},
	nextUntil: function( elem, i, until ) {
		return jQuery.dir( elem, "nextSibling", until );
	},
	prevUntil: function( elem, i, until ) {
		return jQuery.dir( elem, "previousSibling", until );
	},
	siblings: function( elem ) {
		return jQuery.sibling( ( elem.parentNode || {} ).firstChild, elem );
	},
	children: function( elem ) {
		return jQuery.sibling( elem.firstChild );
	},
	contents: function( elem ) {
		return elem.contentDocument || jQuery.merge( [], elem.childNodes );
	}
}, function( name, fn ) {
	jQuery.fn[ name ] = function( until, selector ) {
		var matched = jQuery.map( this, fn, until );

		if ( name.slice( -5 ) !== "Until" ) {
			selector = until;
		}

		if ( selector && typeof selector === "string" ) {
			matched = jQuery.filter( selector, matched );
		}

		if ( this.length > 1 ) {
			// Remove duplicates
			if ( !guaranteedUnique[ name ] ) {
				jQuery.unique( matched );
			}

			// Reverse order for parents* and prev-derivatives
			if ( rparentsprev.test( name ) ) {
				matched.reverse();
			}
		}

		return this.pushStack( matched );
	};
});
var rnotwhite = (/\S+/g);



// String to Object options format cache
var optionsCache = {};

// Convert String-formatted options into Object-formatted ones and store in cache
function createOptions( options ) {
	var object = optionsCache[ options ] = {};
	jQuery.each( options.match( rnotwhite ) || [], function( _, flag ) {
		object[ flag ] = true;
	});
	return object;
}

/*
 * Create a callback list using the following parameters:
 *
 *	options: an optional list of space-separated options that will change how
 *			the callback list behaves or a more traditional option object
 *
 * By default a callback list will act like an event callback list and can be
 * "fired" multiple times.
 *
 * Possible options:
 *
 *	once:			will ensure the callback list can only be fired once (like a Deferred)
 *
 *	memory:			will keep track of previous values and will call any callback added
 *					after the list has been fired right away with the latest "memorized"
 *					values (like a Deferred)
 *
 *	unique:			will ensure a callback can only be added once (no duplicate in the list)
 *
 *	stopOnFalse:	interrupt callings when a callback returns false
 *
 */
jQuery.Callbacks = function( options ) {

	// Convert options from String-formatted to Object-formatted if needed
	// (we check in cache first)
	options = typeof options === "string" ?
		( optionsCache[ options ] || createOptions( options ) ) :
		jQuery.extend( {}, options );

	var // Last fire value (for non-forgettable lists)
		memory,
		// Flag to know if list was already fired
		fired,
		// Flag to know if list is currently firing
		firing,
		// First callback to fire (used internally by add and fireWith)
		firingStart,
		// End of the loop when firing
		firingLength,
		// Index of currently firing callback (modified by remove if needed)
		firingIndex,
		// Actual callback list
		list = [],
		// Stack of fire calls for repeatable lists
		stack = !options.once && [],
		// Fire callbacks
		fire = function( data ) {
			memory = options.memory && data;
			fired = true;
			firingIndex = firingStart || 0;
			firingStart = 0;
			firingLength = list.length;
			firing = true;
			for ( ; list && firingIndex < firingLength; firingIndex++ ) {
				if ( list[ firingIndex ].apply( data[ 0 ], data[ 1 ] ) === false && options.stopOnFalse ) {
					memory = false; // To prevent further calls using add
					break;
				}
			}
			firing = false;
			if ( list ) {
				if ( stack ) {
					if ( stack.length ) {
						fire( stack.shift() );
					}
				} else if ( memory ) {
					list = [];
				} else {
					self.disable();
				}
			}
		},
		// Actual Callbacks object
		self = {
			// Add a callback or a collection of callbacks to the list
			add: function() {
				if ( list ) {
					// First, we save the current length
					var start = list.length;
					(function add( args ) {
						jQuery.each( args, function( _, arg ) {
							var type = jQuery.type( arg );
							if ( type === "function" ) {
								if ( !options.unique || !self.has( arg ) ) {
									list.push( arg );
								}
							} else if ( arg && arg.length && type !== "string" ) {
								// Inspect recursively
								add( arg );
							}
						});
					})( arguments );
					// Do we need to add the callbacks to the
					// current firing batch?
					if ( firing ) {
						firingLength = list.length;
					// With memory, if we're not firing then
					// we should call right away
					} else if ( memory ) {
						firingStart = start;
						fire( memory );
					}
				}
				return this;
			},
			// Remove a callback from the list
			remove: function() {
				if ( list ) {
					jQuery.each( arguments, function( _, arg ) {
						var index;
						while ( ( index = jQuery.inArray( arg, list, index ) ) > -1 ) {
							list.splice( index, 1 );
							// Handle firing indexes
							if ( firing ) {
								if ( index <= firingLength ) {
									firingLength--;
								}
								if ( index <= firingIndex ) {
									firingIndex--;
								}
							}
						}
					});
				}
				return this;
			},
			// Check if a given callback is in the list.
			// If no argument is given, return whether or not list has callbacks attached.
			has: function( fn ) {
				return fn ? jQuery.inArray( fn, list ) > -1 : !!( list && list.length );
			},
			// Remove all callbacks from the list
			empty: function() {
				list = [];
				firingLength = 0;
				return this;
			},
			// Have the list do nothing anymore
			disable: function() {
				list = stack = memory = undefined;
				return this;
			},
			// Is it disabled?
			disabled: function() {
				return !list;
			},
			// Lock the list in its current state
			lock: function() {
				stack = undefined;
				if ( !memory ) {
					self.disable();
				}
				return this;
			},
			// Is it locked?
			locked: function() {
				return !stack;
			},
			// Call all callbacks with the given context and arguments
			fireWith: function( context, args ) {
				if ( list && ( !fired || stack ) ) {
					args = args || [];
					args = [ context, args.slice ? args.slice() : args ];
					if ( firing ) {
						stack.push( args );
					} else {
						fire( args );
					}
				}
				return this;
			},
			// Call all the callbacks with the given arguments
			fire: function() {
				self.fireWith( this, arguments );
				return this;
			},
			// To know if the callbacks have already been called at least once
			fired: function() {
				return !!fired;
			}
		};

	return self;
};


jQuery.extend({

	Deferred: function( func ) {
		var tuples = [
				// action, add listener, listener list, final state
				[ "resolve", "done", jQuery.Callbacks("once memory"), "resolved" ],
				[ "reject", "fail", jQuery.Callbacks("once memory"), "rejected" ],
				[ "notify", "progress", jQuery.Callbacks("memory") ]
			],
			state = "pending",
			promise = {
				state: function() {
					return state;
				},
				always: function() {
					deferred.done( arguments ).fail( arguments );
					return this;
				},
				then: function( /* fnDone, fnFail, fnProgress */ ) {
					var fns = arguments;
					return jQuery.Deferred(function( newDefer ) {
						jQuery.each( tuples, function( i, tuple ) {
							var fn = jQuery.isFunction( fns[ i ] ) && fns[ i ];
							// deferred[ done | fail | progress ] for forwarding actions to newDefer
							deferred[ tuple[1] ](function() {
								var returned = fn && fn.apply( this, arguments );
								if ( returned && jQuery.isFunction( returned.promise ) ) {
									returned.promise()
										.done( newDefer.resolve )
										.fail( newDefer.reject )
										.progress( newDefer.notify );
								} else {
									newDefer[ tuple[ 0 ] + "With" ]( this === promise ? newDefer.promise() : this, fn ? [ returned ] : arguments );
								}
							});
						});
						fns = null;
					}).promise();
				},
				// Get a promise for this deferred
				// If obj is provided, the promise aspect is added to the object
				promise: function( obj ) {
					return obj != null ? jQuery.extend( obj, promise ) : promise;
				}
			},
			deferred = {};

		// Keep pipe for back-compat
		promise.pipe = promise.then;

		// Add list-specific methods
		jQuery.each( tuples, function( i, tuple ) {
			var list = tuple[ 2 ],
				stateString = tuple[ 3 ];

			// promise[ done | fail | progress ] = list.add
			promise[ tuple[1] ] = list.add;

			// Handle state
			if ( stateString ) {
				list.add(function() {
					// state = [ resolved | rejected ]
					state = stateString;

				// [ reject_list | resolve_list ].disable; progress_list.lock
				}, tuples[ i ^ 1 ][ 2 ].disable, tuples[ 2 ][ 2 ].lock );
			}

			// deferred[ resolve | reject | notify ]
			deferred[ tuple[0] ] = function() {
				deferred[ tuple[0] + "With" ]( this === deferred ? promise : this, arguments );
				return this;
			};
			deferred[ tuple[0] + "With" ] = list.fireWith;
		});

		// Make the deferred a promise
		promise.promise( deferred );

		// Call given func if any
		if ( func ) {
			func.call( deferred, deferred );
		}

		// All done!
		return deferred;
	},

	// Deferred helper
	when: function( subordinate /* , ..., subordinateN */ ) {
		var i = 0,
			resolveValues = slice.call( arguments ),
			length = resolveValues.length,

			// the count of uncompleted subordinates
			remaining = length !== 1 || ( subordinate && jQuery.isFunction( subordinate.promise ) ) ? length : 0,

			// the master Deferred. If resolveValues consist of only a single Deferred, just use that.
			deferred = remaining === 1 ? subordinate : jQuery.Deferred(),

			// Update function for both resolve and progress values
			updateFunc = function( i, contexts, values ) {
				return function( value ) {
					contexts[ i ] = this;
					values[ i ] = arguments.length > 1 ? slice.call( arguments ) : value;
					if ( values === progressValues ) {
						deferred.notifyWith( contexts, values );
					} else if ( !( --remaining ) ) {
						deferred.resolveWith( contexts, values );
					}
				};
			},

			progressValues, progressContexts, resolveContexts;

		// add listeners to Deferred subordinates; treat others as resolved
		if ( length > 1 ) {
			progressValues = new Array( length );
			progressContexts = new Array( length );
			resolveContexts = new Array( length );
			for ( ; i < length; i++ ) {
				if ( resolveValues[ i ] && jQuery.isFunction( resolveValues[ i ].promise ) ) {
					resolveValues[ i ].promise()
						.done( updateFunc( i, resolveContexts, resolveValues ) )
						.fail( deferred.reject )
						.progress( updateFunc( i, progressContexts, progressValues ) );
				} else {
					--remaining;
				}
			}
		}

		// if we're not waiting on anything, resolve the master
		if ( !remaining ) {
			deferred.resolveWith( resolveContexts, resolveValues );
		}

		return deferred.promise();
	}
});


// The deferred used on DOM ready
var readyList;

jQuery.fn.ready = function( fn ) {
	// Add the callback
	jQuery.ready.promise().done( fn );

	return this;
};

jQuery.extend({
	// Is the DOM ready to be used? Set to true once it occurs.
	isReady: false,

	// A counter to track how many items to wait for before
	// the ready event fires. See #6781
	readyWait: 1,

	// Hold (or release) the ready event
	holdReady: function( hold ) {
		if ( hold ) {
			jQuery.readyWait++;
		} else {
			jQuery.ready( true );
		}
	},

	// Handle when the DOM is ready
	ready: function( wait ) {

		// Abort if there are pending holds or we're already ready
		if ( wait === true ? --jQuery.readyWait : jQuery.isReady ) {
			return;
		}

		// Remember that the DOM is ready
		jQuery.isReady = true;

		// If a normal DOM Ready event fired, decrement, and wait if need be
		if ( wait !== true && --jQuery.readyWait > 0 ) {
			return;
		}

		// If there are functions bound, to execute
		readyList.resolveWith( document, [ jQuery ] );

		// Trigger any bound ready events
		if ( jQuery.fn.triggerHandler ) {
			jQuery( document ).triggerHandler( "ready" );
			jQuery( document ).off( "ready" );
		}
	}
});

/**
 * The ready event handler and self cleanup method
 */
function completed() {
	document.removeEventListener( "DOMContentLoaded", completed, false );
	window.removeEventListener( "load", completed, false );
	jQuery.ready();
}

jQuery.ready.promise = function( obj ) {
	if ( !readyList ) {

		readyList = jQuery.Deferred();

		// Catch cases where $(document).ready() is called after the browser event has already occurred.
		// we once tried to use readyState "interactive" here, but it caused issues like the one
		// discovered by ChrisS here: http://bugs.jquery.com/ticket/12282#comment:15
		if ( document.readyState === "complete" ) {
			// Handle it asynchronously to allow scripts the opportunity to delay ready
			setTimeout( jQuery.ready );

		} else {

			// Use the handy event callback
			document.addEventListener( "DOMContentLoaded", completed, false );

			// A fallback to window.onload, that will always work
			window.addEventListener( "load", completed, false );
		}
	}
	return readyList.promise( obj );
};

// Kick off the DOM ready check even if the user does not
jQuery.ready.promise();




// Multifunctional method to get and set values of a collection
// The value/s can optionally be executed if it's a function
var access = jQuery.access = function( elems, fn, key, value, chainable, emptyGet, raw ) {
	var i = 0,
		len = elems.length,
		bulk = key == null;

	// Sets many values
	if ( jQuery.type( key ) === "object" ) {
		chainable = true;
		for ( i in key ) {
			jQuery.access( elems, fn, i, key[i], true, emptyGet, raw );
		}

	// Sets one value
	} else if ( value !== undefined ) {
		chainable = true;

		if ( !jQuery.isFunction( value ) ) {
			raw = true;
		}

		if ( bulk ) {
			// Bulk operations run against the entire set
			if ( raw ) {
				fn.call( elems, value );
				fn = null;

			// ...except when executing function values
			} else {
				bulk = fn;
				fn = function( elem, key, value ) {
					return bulk.call( jQuery( elem ), value );
				};
			}
		}

		if ( fn ) {
			for ( ; i < len; i++ ) {
				fn( elems[i], key, raw ? value : value.call( elems[i], i, fn( elems[i], key ) ) );
			}
		}
	}

	return chainable ?
		elems :

		// Gets
		bulk ?
			fn.call( elems ) :
			len ? fn( elems[0], key ) : emptyGet;
};


/**
 * Determines whether an object can have data
 */
jQuery.acceptData = function( owner ) {
	// Accepts only:
	//  - Node
	//    - Node.ELEMENT_NODE
	//    - Node.DOCUMENT_NODE
	//  - Object
	//    - Any
	/* jshint -W018 */
	return owner.nodeType === 1 || owner.nodeType === 9 || !( +owner.nodeType );
};


function Data() {
	// Support: Android < 4,
	// Old WebKit does not have Object.preventExtensions/freeze method,
	// return new empty object instead with no [[set]] accessor
	Object.defineProperty( this.cache = {}, 0, {
		get: function() {
			return {};
		}
	});

	this.expando = jQuery.expando + Math.random();
}

Data.uid = 1;
Data.accepts = jQuery.acceptData;

Data.prototype = {
	key: function( owner ) {
		// We can accept data for non-element nodes in modern browsers,
		// but we should not, see #8335.
		// Always return the key for a frozen object.
		if ( !Data.accepts( owner ) ) {
			return 0;
		}

		var descriptor = {},
			// Check if the owner object already has a cache key
			unlock = owner[ this.expando ];

		// If not, create one
		if ( !unlock ) {
			unlock = Data.uid++;

			// Secure it in a non-enumerable, non-writable property
			try {
				descriptor[ this.expando ] = { value: unlock };
				Object.defineProperties( owner, descriptor );

			// Support: Android < 4
			// Fallback to a less secure definition
			} catch ( e ) {
				descriptor[ this.expando ] = unlock;
				jQuery.extend( owner, descriptor );
			}
		}

		// Ensure the cache object
		if ( !this.cache[ unlock ] ) {
			this.cache[ unlock ] = {};
		}

		return unlock;
	},
	set: function( owner, data, value ) {
		var prop,
			// There may be an unlock assigned to this node,
			// if there is no entry for this "owner", create one inline
			// and set the unlock as though an owner entry had always existed
			unlock = this.key( owner ),
			cache = this.cache[ unlock ];

		// Handle: [ owner, key, value ] args
		if ( typeof data === "string" ) {
			cache[ data ] = value;

		// Handle: [ owner, { properties } ] args
		} else {
			// Fresh assignments by object are shallow copied
			if ( jQuery.isEmptyObject( cache ) ) {
				jQuery.extend( this.cache[ unlock ], data );
			// Otherwise, copy the properties one-by-one to the cache object
			} else {
				for ( prop in data ) {
					cache[ prop ] = data[ prop ];
				}
			}
		}
		return cache;
	},
	get: function( owner, key ) {
		// Either a valid cache is found, or will be created.
		// New caches will be created and the unlock returned,
		// allowing direct access to the newly created
		// empty data object. A valid owner object must be provided.
		var cache = this.cache[ this.key( owner ) ];

		return key === undefined ?
			cache : cache[ key ];
	},
	access: function( owner, key, value ) {
		var stored;
		// In cases where either:
		//
		//   1. No key was specified
		//   2. A string key was specified, but no value provided
		//
		// Take the "read" path and allow the get method to determine
		// which value to return, respectively either:
		//
		//   1. The entire cache object
		//   2. The data stored at the key
		//
		if ( key === undefined ||
				((key && typeof key === "string") && value === undefined) ) {

			stored = this.get( owner, key );

			return stored !== undefined ?
				stored : this.get( owner, jQuery.camelCase(key) );
		}

		// [*]When the key is not a string, or both a key and value
		// are specified, set or extend (existing objects) with either:
		//
		//   1. An object of properties
		//   2. A key and value
		//
		this.set( owner, key, value );

		// Since the "set" path can have two possible entry points
		// return the expected data based on which path was taken[*]
		return value !== undefined ? value : key;
	},
	remove: function( owner, key ) {
		var i, name, camel,
			unlock = this.key( owner ),
			cache = this.cache[ unlock ];

		if ( key === undefined ) {
			this.cache[ unlock ] = {};

		} else {
			// Support array or space separated string of keys
			if ( jQuery.isArray( key ) ) {
				// If "name" is an array of keys...
				// When data is initially created, via ("key", "val") signature,
				// keys will be converted to camelCase.
				// Since there is no way to tell _how_ a key was added, remove
				// both plain key and camelCase key. #12786
				// This will only penalize the array argument path.
				name = key.concat( key.map( jQuery.camelCase ) );
			} else {
				camel = jQuery.camelCase( key );
				// Try the string as a key before any manipulation
				if ( key in cache ) {
					name = [ key, camel ];
				} else {
					// If a key with the spaces exists, use it.
					// Otherwise, create an array by matching non-whitespace
					name = camel;
					name = name in cache ?
						[ name ] : ( name.match( rnotwhite ) || [] );
				}
			}

			i = name.length;
			while ( i-- ) {
				delete cache[ name[ i ] ];
			}
		}
	},
	hasData: function( owner ) {
		return !jQuery.isEmptyObject(
			this.cache[ owner[ this.expando ] ] || {}
		);
	},
	discard: function( owner ) {
		if ( owner[ this.expando ] ) {
			delete this.cache[ owner[ this.expando ] ];
		}
	}
};
var data_priv = new Data();

var data_user = new Data();



/*
	Implementation Summary

	1. Enforce API surface and semantic compatibility with 1.9.x branch
	2. Improve the module's maintainability by reducing the storage
		paths to a single mechanism.
	3. Use the same single mechanism to support "private" and "user" data.
	4. _Never_ expose "private" data to user code (TODO: Drop _data, _removeData)
	5. Avoid exposing implementation details on user objects (eg. expando properties)
	6. Provide a clear path for implementation upgrade to WeakMap in 2014
*/
var rbrace = /^(?:\{[\w\W]*\}|\[[\w\W]*\])$/,
	rmultiDash = /([A-Z])/g;

function dataAttr( elem, key, data ) {
	var name;

	// If nothing was found internally, try to fetch any
	// data from the HTML5 data-* attribute
	if ( data === undefined && elem.nodeType === 1 ) {
		name = "data-" + key.replace( rmultiDash, "-$1" ).toLowerCase();
		data = elem.getAttribute( name );

		if ( typeof data === "string" ) {
			try {
				data = data === "true" ? true :
					data === "false" ? false :
					data === "null" ? null :
					// Only convert to a number if it doesn't change the string
					+data + "" === data ? +data :
					rbrace.test( data ) ? jQuery.parseJSON( data ) :
					data;
			} catch( e ) {}

			// Make sure we set the data so it isn't changed later
			data_user.set( elem, key, data );
		} else {
			data = undefined;
		}
	}
	return data;
}

jQuery.extend({
	hasData: function( elem ) {
		return data_user.hasData( elem ) || data_priv.hasData( elem );
	},

	data: function( elem, name, data ) {
		return data_user.access( elem, name, data );
	},

	removeData: function( elem, name ) {
		data_user.remove( elem, name );
	},

	// TODO: Now that all calls to _data and _removeData have been replaced
	// with direct calls to data_priv methods, these can be deprecated.
	_data: function( elem, name, data ) {
		return data_priv.access( elem, name, data );
	},

	_removeData: function( elem, name ) {
		data_priv.remove( elem, name );
	}
});

jQuery.fn.extend({
	data: function( key, value ) {
		var i, name, data,
			elem = this[ 0 ],
			attrs = elem && elem.attributes;

		// Gets all values
		if ( key === undefined ) {
			if ( this.length ) {
				data = data_user.get( elem );

				if ( elem.nodeType === 1 && !data_priv.get( elem, "hasDataAttrs" ) ) {
					i = attrs.length;
					while ( i-- ) {

						// Support: IE11+
						// The attrs elements can be null (#14894)
						if ( attrs[ i ] ) {
							name = attrs[ i ].name;
							if ( name.indexOf( "data-" ) === 0 ) {
								name = jQuery.camelCase( name.slice(5) );
								dataAttr( elem, name, data[ name ] );
							}
						}
					}
					data_priv.set( elem, "hasDataAttrs", true );
				}
			}

			return data;
		}

		// Sets multiple values
		if ( typeof key === "object" ) {
			return this.each(function() {
				data_user.set( this, key );
			});
		}

		return access( this, function( value ) {
			var data,
				camelKey = jQuery.camelCase( key );

			// The calling jQuery object (element matches) is not empty
			// (and therefore has an element appears at this[ 0 ]) and the
			// `value` parameter was not undefined. An empty jQuery object
			// will result in `undefined` for elem = this[ 0 ] which will
			// throw an exception if an attempt to read a data cache is made.
			if ( elem && value === undefined ) {
				// Attempt to get data from the cache
				// with the key as-is
				data = data_user.get( elem, key );
				if ( data !== undefined ) {
					return data;
				}

				// Attempt to get data from the cache
				// with the key camelized
				data = data_user.get( elem, camelKey );
				if ( data !== undefined ) {
					return data;
				}

				// Attempt to "discover" the data in
				// HTML5 custom data-* attrs
				data = dataAttr( elem, camelKey, undefined );
				if ( data !== undefined ) {
					return data;
				}

				// We tried really hard, but the data doesn't exist.
				return;
			}

			// Set the data...
			this.each(function() {
				// First, attempt to store a copy or reference of any
				// data that might've been store with a camelCased key.
				var data = data_user.get( this, camelKey );

				// For HTML5 data-* attribute interop, we have to
				// store property names with dashes in a camelCase form.
				// This might not apply to all properties...*
				data_user.set( this, camelKey, value );

				// *... In the case of properties that might _actually_
				// have dashes, we need to also store a copy of that
				// unchanged property.
				if ( key.indexOf("-") !== -1 && data !== undefined ) {
					data_user.set( this, key, value );
				}
			});
		}, null, value, arguments.length > 1, null, true );
	},

	removeData: function( key ) {
		return this.each(function() {
			data_user.remove( this, key );
		});
	}
});


jQuery.extend({
	queue: function( elem, type, data ) {
		var queue;

		if ( elem ) {
			type = ( type || "fx" ) + "queue";
			queue = data_priv.get( elem, type );

			// Speed up dequeue by getting out quickly if this is just a lookup
			if ( data ) {
				if ( !queue || jQuery.isArray( data ) ) {
					queue = data_priv.access( elem, type, jQuery.makeArray(data) );
				} else {
					queue.push( data );
				}
			}
			return queue || [];
		}
	},

	dequeue: function( elem, type ) {
		type = type || "fx";

		var queue = jQuery.queue( elem, type ),
			startLength = queue.length,
			fn = queue.shift(),
			hooks = jQuery._queueHooks( elem, type ),
			next = function() {
				jQuery.dequeue( elem, type );
			};

		// If the fx queue is dequeued, always remove the progress sentinel
		if ( fn === "inprogress" ) {
			fn = queue.shift();
			startLength--;
		}

		if ( fn ) {

			// Add a progress sentinel to prevent the fx queue from being
			// automatically dequeued
			if ( type === "fx" ) {
				queue.unshift( "inprogress" );
			}

			// clear up the last queue stop function
			delete hooks.stop;
			fn.call( elem, next, hooks );
		}

		if ( !startLength && hooks ) {
			hooks.empty.fire();
		}
	},

	// not intended for public consumption - generates a queueHooks object, or returns the current one
	_queueHooks: function( elem, type ) {
		var key = type + "queueHooks";
		return data_priv.get( elem, key ) || data_priv.access( elem, key, {
			empty: jQuery.Callbacks("once memory").add(function() {
				data_priv.remove( elem, [ type + "queue", key ] );
			})
		});
	}
});

jQuery.fn.extend({
	queue: function( type, data ) {
		var setter = 2;

		if ( typeof type !== "string" ) {
			data = type;
			type = "fx";
			setter--;
		}

		if ( arguments.length < setter ) {
			return jQuery.queue( this[0], type );
		}

		return data === undefined ?
			this :
			this.each(function() {
				var queue = jQuery.queue( this, type, data );

				// ensure a hooks for this queue
				jQuery._queueHooks( this, type );

				if ( type === "fx" && queue[0] !== "inprogress" ) {
					jQuery.dequeue( this, type );
				}
			});
	},
	dequeue: function( type ) {
		return this.each(function() {
			jQuery.dequeue( this, type );
		});
	},
	clearQueue: function( type ) {
		return this.queue( type || "fx", [] );
	},
	// Get a promise resolved when queues of a certain type
	// are emptied (fx is the type by default)
	promise: function( type, obj ) {
		var tmp,
			count = 1,
			defer = jQuery.Deferred(),
			elements = this,
			i = this.length,
			resolve = function() {
				if ( !( --count ) ) {
					defer.resolveWith( elements, [ elements ] );
				}
			};

		if ( typeof type !== "string" ) {
			obj = type;
			type = undefined;
		}
		type = type || "fx";

		while ( i-- ) {
			tmp = data_priv.get( elements[ i ], type + "queueHooks" );
			if ( tmp && tmp.empty ) {
				count++;
				tmp.empty.add( resolve );
			}
		}
		resolve();
		return defer.promise( obj );
	}
});
var pnum = (/[+-]?(?:\d*\.|)\d+(?:[eE][+-]?\d+|)/).source;

var cssExpand = [ "Top", "Right", "Bottom", "Left" ];

var isHidden = function( elem, el ) {
		// isHidden might be called from jQuery#filter function;
		// in that case, element will be second argument
		elem = el || elem;
		return jQuery.css( elem, "display" ) === "none" || !jQuery.contains( elem.ownerDocument, elem );
	};

var rcheckableType = (/^(?:checkbox|radio)$/i);



(function() {
	var fragment = document.createDocumentFragment(),
		div = fragment.appendChild( document.createElement( "div" ) ),
		input = document.createElement( "input" );

	// #11217 - WebKit loses check when the name is after the checked attribute
	// Support: Windows Web Apps (WWA)
	// `name` and `type` need .setAttribute for WWA
	input.setAttribute( "type", "radio" );
	input.setAttribute( "checked", "checked" );
	input.setAttribute( "name", "t" );

	div.appendChild( input );

	// Support: Safari 5.1, iOS 5.1, Android 4.x, Android 2.3
	// old WebKit doesn't clone checked state correctly in fragments
	support.checkClone = div.cloneNode( true ).cloneNode( true ).lastChild.checked;

	// Make sure textarea (and checkbox) defaultValue is properly cloned
	// Support: IE9-IE11+
	div.innerHTML = "<textarea>x</textarea>";
	support.noCloneChecked = !!div.cloneNode( true ).lastChild.defaultValue;
})();
var strundefined = typeof undefined;



support.focusinBubbles = "onfocusin" in window;


var
	rkeyEvent = /^key/,
	rmouseEvent = /^(?:mouse|pointer|contextmenu)|click/,
	rfocusMorph = /^(?:focusinfocus|focusoutblur)$/,
	rtypenamespace = /^([^.]*)(?:\.(.+)|)$/;

function returnTrue() {
	return true;
}

function returnFalse() {
	return false;
}

function safeActiveElement() {
	try {
		return document.activeElement;
	} catch ( err ) { }
}

/*
 * Helper functions for managing events -- not part of the public interface.
 * Props to Dean Edwards' addEvent library for many of the ideas.
 */
jQuery.event = {

	global: {},

	add: function( elem, types, handler, data, selector ) {

		var handleObjIn, eventHandle, tmp,
			events, t, handleObj,
			special, handlers, type, namespaces, origType,
			elemData = data_priv.get( elem );

		// Don't attach events to noData or text/comment nodes (but allow plain objects)
		if ( !elemData ) {
			return;
		}

		// Caller can pass in an object of custom data in lieu of the handler
		if ( handler.handler ) {
			handleObjIn = handler;
			handler = handleObjIn.handler;
			selector = handleObjIn.selector;
		}

		// Make sure that the handler has a unique ID, used to find/remove it later
		if ( !handler.guid ) {
			handler.guid = jQuery.guid++;
		}

		// Init the element's event structure and main handler, if this is the first
		if ( !(events = elemData.events) ) {
			events = elemData.events = {};
		}
		if ( !(eventHandle = elemData.handle) ) {
			eventHandle = elemData.handle = function( e ) {
				// Discard the second event of a jQuery.event.trigger() and
				// when an event is called after a page has unloaded
				return typeof jQuery !== strundefined && jQuery.event.triggered !== e.type ?
					jQuery.event.dispatch.apply( elem, arguments ) : undefined;
			};
		}

		// Handle multiple events separated by a space
		types = ( types || "" ).match( rnotwhite ) || [ "" ];
		t = types.length;
		while ( t-- ) {
			tmp = rtypenamespace.exec( types[t] ) || [];
			type = origType = tmp[1];
			namespaces = ( tmp[2] || "" ).split( "." ).sort();

			// There *must* be a type, no attaching namespace-only handlers
			if ( !type ) {
				continue;
			}

			// If event changes its type, use the special event handlers for the changed type
			special = jQuery.event.special[ type ] || {};

			// If selector defined, determine special event api type, otherwise given type
			type = ( selector ? special.delegateType : special.bindType ) || type;

			// Update special based on newly reset type
			special = jQuery.event.special[ type ] || {};

			// handleObj is passed to all event handlers
			handleObj = jQuery.extend({
				type: type,
				origType: origType,
				data: data,
				handler: handler,
				guid: handler.guid,
				selector: selector,
				needsContext: selector && jQuery.expr.match.needsContext.test( selector ),
				namespace: namespaces.join(".")
			}, handleObjIn );

			// Init the event handler queue if we're the first
			if ( !(handlers = events[ type ]) ) {
				handlers = events[ type ] = [];
				handlers.delegateCount = 0;

				// Only use addEventListener if the special events handler returns false
				if ( !special.setup || special.setup.call( elem, data, namespaces, eventHandle ) === false ) {
					if ( elem.addEventListener ) {
						elem.addEventListener( type, eventHandle, false );
					}
				}
			}

			if ( special.add ) {
				special.add.call( elem, handleObj );

				if ( !handleObj.handler.guid ) {
					handleObj.handler.guid = handler.guid;
				}
			}

			// Add to the element's handler list, delegates in front
			if ( selector ) {
				handlers.splice( handlers.delegateCount++, 0, handleObj );
			} else {
				handlers.push( handleObj );
			}

			// Keep track of which events have ever been used, for event optimization
			jQuery.event.global[ type ] = true;
		}

	},

	// Detach an event or set of events from an element
	remove: function( elem, types, handler, selector, mappedTypes ) {

		var j, origCount, tmp,
			events, t, handleObj,
			special, handlers, type, namespaces, origType,
			elemData = data_priv.hasData( elem ) && data_priv.get( elem );

		if ( !elemData || !(events = elemData.events) ) {
			return;
		}

		// Once for each type.namespace in types; type may be omitted
		types = ( types || "" ).match( rnotwhite ) || [ "" ];
		t = types.length;
		while ( t-- ) {
			tmp = rtypenamespace.exec( types[t] ) || [];
			type = origType = tmp[1];
			namespaces = ( tmp[2] || "" ).split( "." ).sort();

			// Unbind all events (on this namespace, if provided) for the element
			if ( !type ) {
				for ( type in events ) {
					jQuery.event.remove( elem, type + types[ t ], handler, selector, true );
				}
				continue;
			}

			special = jQuery.event.special[ type ] || {};
			type = ( selector ? special.delegateType : special.bindType ) || type;
			handlers = events[ type ] || [];
			tmp = tmp[2] && new RegExp( "(^|\\.)" + namespaces.join("\\.(?:.*\\.|)") + "(\\.|$)" );

			// Remove matching events
			origCount = j = handlers.length;
			while ( j-- ) {
				handleObj = handlers[ j ];

				if ( ( mappedTypes || origType === handleObj.origType ) &&
					( !handler || handler.guid === handleObj.guid ) &&
					( !tmp || tmp.test( handleObj.namespace ) ) &&
					( !selector || selector === handleObj.selector || selector === "**" && handleObj.selector ) ) {
					handlers.splice( j, 1 );

					if ( handleObj.selector ) {
						handlers.delegateCount--;
					}
					if ( special.remove ) {
						special.remove.call( elem, handleObj );
					}
				}
			}

			// Remove generic event handler if we removed something and no more handlers exist
			// (avoids potential for endless recursion during removal of special event handlers)
			if ( origCount && !handlers.length ) {
				if ( !special.teardown || special.teardown.call( elem, namespaces, elemData.handle ) === false ) {
					jQuery.removeEvent( elem, type, elemData.handle );
				}

				delete events[ type ];
			}
		}

		// Remove the expando if it's no longer used
		if ( jQuery.isEmptyObject( events ) ) {
			delete elemData.handle;
			data_priv.remove( elem, "events" );
		}
	},

	trigger: function( event, data, elem, onlyHandlers ) {

		var i, cur, tmp, bubbleType, ontype, handle, special,
			eventPath = [ elem || document ],
			type = hasOwn.call( event, "type" ) ? event.type : event,
			namespaces = hasOwn.call( event, "namespace" ) ? event.namespace.split(".") : [];

		cur = tmp = elem = elem || document;

		// Don't do events on text and comment nodes
		if ( elem.nodeType === 3 || elem.nodeType === 8 ) {
			return;
		}

		// focus/blur morphs to focusin/out; ensure we're not firing them right now
		if ( rfocusMorph.test( type + jQuery.event.triggered ) ) {
			return;
		}

		if ( type.indexOf(".") >= 0 ) {
			// Namespaced trigger; create a regexp to match event type in handle()
			namespaces = type.split(".");
			type = namespaces.shift();
			namespaces.sort();
		}
		ontype = type.indexOf(":") < 0 && "on" + type;

		// Caller can pass in a jQuery.Event object, Object, or just an event type string
		event = event[ jQuery.expando ] ?
			event :
			new jQuery.Event( type, typeof event === "object" && event );

		// Trigger bitmask: & 1 for native handlers; & 2 for jQuery (always true)
		event.isTrigger = onlyHandlers ? 2 : 3;
		event.namespace = namespaces.join(".");
		event.namespace_re = event.namespace ?
			new RegExp( "(^|\\.)" + namespaces.join("\\.(?:.*\\.|)") + "(\\.|$)" ) :
			null;

		// Clean up the event in case it is being reused
		event.result = undefined;
		if ( !event.target ) {
			event.target = elem;
		}

		// Clone any incoming data and prepend the event, creating the handler arg list
		data = data == null ?
			[ event ] :
			jQuery.makeArray( data, [ event ] );

		// Allow special events to draw outside the lines
		special = jQuery.event.special[ type ] || {};
		if ( !onlyHandlers && special.trigger && special.trigger.apply( elem, data ) === false ) {
			return;
		}

		// Determine event propagation path in advance, per W3C events spec (#9951)
		// Bubble up to document, then to window; watch for a global ownerDocument var (#9724)
		if ( !onlyHandlers && !special.noBubble && !jQuery.isWindow( elem ) ) {

			bubbleType = special.delegateType || type;
			if ( !rfocusMorph.test( bubbleType + type ) ) {
				cur = cur.parentNode;
			}
			for ( ; cur; cur = cur.parentNode ) {
				eventPath.push( cur );
				tmp = cur;
			}

			// Only add window if we got to document (e.g., not plain obj or detached DOM)
			if ( tmp === (elem.ownerDocument || document) ) {
				eventPath.push( tmp.defaultView || tmp.parentWindow || window );
			}
		}

		// Fire handlers on the event path
		i = 0;
		while ( (cur = eventPath[i++]) && !event.isPropagationStopped() ) {

			event.type = i > 1 ?
				bubbleType :
				special.bindType || type;

			// jQuery handler
			handle = ( data_priv.get( cur, "events" ) || {} )[ event.type ] && data_priv.get( cur, "handle" );
			if ( handle ) {
				handle.apply( cur, data );
			}

			// Native handler
			handle = ontype && cur[ ontype ];
			if ( handle && handle.apply && jQuery.acceptData( cur ) ) {
				event.result = handle.apply( cur, data );
				if ( event.result === false ) {
					event.preventDefault();
				}
			}
		}
		event.type = type;

		// If nobody prevented the default action, do it now
		if ( !onlyHandlers && !event.isDefaultPrevented() ) {

			if ( (!special._default || special._default.apply( eventPath.pop(), data ) === false) &&
				jQuery.acceptData( elem ) ) {

				// Call a native DOM method on the target with the same name name as the event.
				// Don't do default actions on window, that's where global variables be (#6170)
				if ( ontype && jQuery.isFunction( elem[ type ] ) && !jQuery.isWindow( elem ) ) {

					// Don't re-trigger an onFOO event when we call its FOO() method
					tmp = elem[ ontype ];

					if ( tmp ) {
						elem[ ontype ] = null;
					}

					// Prevent re-triggering of the same event, since we already bubbled it above
					jQuery.event.triggered = type;
					elem[ type ]();
					jQuery.event.triggered = undefined;

					if ( tmp ) {
						elem[ ontype ] = tmp;
					}
				}
			}
		}

		return event.result;
	},

	dispatch: function( event ) {

		// Make a writable jQuery.Event from the native event object
		event = jQuery.event.fix( event );

		var i, j, ret, matched, handleObj,
			handlerQueue = [],
			args = slice.call( arguments ),
			handlers = ( data_priv.get( this, "events" ) || {} )[ event.type ] || [],
			special = jQuery.event.special[ event.type ] || {};

		// Use the fix-ed jQuery.Event rather than the (read-only) native event
		args[0] = event;
		event.delegateTarget = this;

		// Call the preDispatch hook for the mapped type, and let it bail if desired
		if ( special.preDispatch && special.preDispatch.call( this, event ) === false ) {
			return;
		}

		// Determine handlers
		handlerQueue = jQuery.event.handlers.call( this, event, handlers );

		// Run delegates first; they may want to stop propagation beneath us
		i = 0;
		while ( (matched = handlerQueue[ i++ ]) && !event.isPropagationStopped() ) {
			event.currentTarget = matched.elem;

			j = 0;
			while ( (handleObj = matched.handlers[ j++ ]) && !event.isImmediatePropagationStopped() ) {

				// Triggered event must either 1) have no namespace, or
				// 2) have namespace(s) a subset or equal to those in the bound event (both can have no namespace).
				if ( !event.namespace_re || event.namespace_re.test( handleObj.namespace ) ) {

					event.handleObj = handleObj;
					event.data = handleObj.data;

					ret = ( (jQuery.event.special[ handleObj.origType ] || {}).handle || handleObj.handler )
							.apply( matched.elem, args );

					if ( ret !== undefined ) {
						if ( (event.result = ret) === false ) {
							event.preventDefault();
							event.stopPropagation();
						}
					}
				}
			}
		}

		// Call the postDispatch hook for the mapped type
		if ( special.postDispatch ) {
			special.postDispatch.call( this, event );
		}

		return event.result;
	},

	handlers: function( event, handlers ) {
		var i, matches, sel, handleObj,
			handlerQueue = [],
			delegateCount = handlers.delegateCount,
			cur = event.target;

		// Find delegate handlers
		// Black-hole SVG <use> instance trees (#13180)
		// Avoid non-left-click bubbling in Firefox (#3861)
		if ( delegateCount && cur.nodeType && (!event.button || event.type !== "click") ) {

			for ( ; cur !== this; cur = cur.parentNode || this ) {

				// Don't process clicks on disabled elements (#6911, #8165, #11382, #11764)
				if ( cur.disabled !== true || event.type !== "click" ) {
					matches = [];
					for ( i = 0; i < delegateCount; i++ ) {
						handleObj = handlers[ i ];

						// Don't conflict with Object.prototype properties (#13203)
						sel = handleObj.selector + " ";

						if ( matches[ sel ] === undefined ) {
							matches[ sel ] = handleObj.needsContext ?
								jQuery( sel, this ).index( cur ) >= 0 :
								jQuery.find( sel, this, null, [ cur ] ).length;
						}
						if ( matches[ sel ] ) {
							matches.push( handleObj );
						}
					}
					if ( matches.length ) {
						handlerQueue.push({ elem: cur, handlers: matches });
					}
				}
			}
		}

		// Add the remaining (directly-bound) handlers
		if ( delegateCount < handlers.length ) {
			handlerQueue.push({ elem: this, handlers: handlers.slice( delegateCount ) });
		}

		return handlerQueue;
	},

	// Includes some event props shared by KeyEvent and MouseEvent
	props: "altKey bubbles cancelable ctrlKey currentTarget eventPhase metaKey relatedTarget shiftKey target timeStamp view which".split(" "),

	fixHooks: {},

	keyHooks: {
		props: "char charCode key keyCode".split(" "),
		filter: function( event, original ) {

			// Add which for key events
			if ( event.which == null ) {
				event.which = original.charCode != null ? original.charCode : original.keyCode;
			}

			return event;
		}
	},

	mouseHooks: {
		props: "button buttons clientX clientY offsetX offsetY pageX pageY screenX screenY toElement".split(" "),
		filter: function( event, original ) {
			var eventDoc, doc, body,
				button = original.button;

			// Calculate pageX/Y if missing and clientX/Y available
			if ( event.pageX == null && original.clientX != null ) {
				eventDoc = event.target.ownerDocument || document;
				doc = eventDoc.documentElement;
				body = eventDoc.body;

				event.pageX = original.clientX + ( doc && doc.scrollLeft || body && body.scrollLeft || 0 ) - ( doc && doc.clientLeft || body && body.clientLeft || 0 );
				event.pageY = original.clientY + ( doc && doc.scrollTop  || body && body.scrollTop  || 0 ) - ( doc && doc.clientTop  || body && body.clientTop  || 0 );
			}

			// Add which for click: 1 === left; 2 === middle; 3 === right
			// Note: button is not normalized, so don't use it
			if ( !event.which && button !== undefined ) {
				event.which = ( button & 1 ? 1 : ( button & 2 ? 3 : ( button & 4 ? 2 : 0 ) ) );
			}

			return event;
		}
	},

	fix: function( event ) {
		if ( event[ jQuery.expando ] ) {
			return event;
		}

		// Create a writable copy of the event object and normalize some properties
		var i, prop, copy,
			type = event.type,
			originalEvent = event,
			fixHook = this.fixHooks[ type ];

		if ( !fixHook ) {
			this.fixHooks[ type ] = fixHook =
				rmouseEvent.test( type ) ? this.mouseHooks :
				rkeyEvent.test( type ) ? this.keyHooks :
				{};
		}
		copy = fixHook.props ? this.props.concat( fixHook.props ) : this.props;

		event = new jQuery.Event( originalEvent );

		i = copy.length;
		while ( i-- ) {
			prop = copy[ i ];
			event[ prop ] = originalEvent[ prop ];
		}

		// Support: Cordova 2.5 (WebKit) (#13255)
		// All events should have a target; Cordova deviceready doesn't
		if ( !event.target ) {
			event.target = document;
		}

		// Support: Safari 6.0+, Chrome < 28
		// Target should not be a text node (#504, #13143)
		if ( event.target.nodeType === 3 ) {
			event.target = event.target.parentNode;
		}

		return fixHook.filter ? fixHook.filter( event, originalEvent ) : event;
	},

	special: {
		load: {
			// Prevent triggered image.load events from bubbling to window.load
			noBubble: true
		},
		focus: {
			// Fire native event if possible so blur/focus sequence is correct
			trigger: function() {
				if ( this !== safeActiveElement() && this.focus ) {
					this.focus();
					return false;
				}
			},
			delegateType: "focusin"
		},
		blur: {
			trigger: function() {
				if ( this === safeActiveElement() && this.blur ) {
					this.blur();
					return false;
				}
			},
			delegateType: "focusout"
		},
		click: {
			// For checkbox, fire native event so checked state will be right
			trigger: function() {
				if ( this.type === "checkbox" && this.click && jQuery.nodeName( this, "input" ) ) {
					this.click();
					return false;
				}
			},

			// For cross-browser consistency, don't fire native .click() on links
			_default: function( event ) {
				return jQuery.nodeName( event.target, "a" );
			}
		},

		beforeunload: {
			postDispatch: function( event ) {

				// Support: Firefox 20+
				// Firefox doesn't alert if the returnValue field is not set.
				if ( event.result !== undefined && event.originalEvent ) {
					event.originalEvent.returnValue = event.result;
				}
			}
		}
	},

	simulate: function( type, elem, event, bubble ) {
		// Piggyback on a donor event to simulate a different one.
		// Fake originalEvent to avoid donor's stopPropagation, but if the
		// simulated event prevents default then we do the same on the donor.
		var e = jQuery.extend(
			new jQuery.Event(),
			event,
			{
				type: type,
				isSimulated: true,
				originalEvent: {}
			}
		);
		if ( bubble ) {
			jQuery.event.trigger( e, null, elem );
		} else {
			jQuery.event.dispatch.call( elem, e );
		}
		if ( e.isDefaultPrevented() ) {
			event.preventDefault();
		}
	}
};

jQuery.removeEvent = function( elem, type, handle ) {
	if ( elem.removeEventListener ) {
		elem.removeEventListener( type, handle, false );
	}
};

jQuery.Event = function( src, props ) {
	// Allow instantiation without the 'new' keyword
	if ( !(this instanceof jQuery.Event) ) {
		return new jQuery.Event( src, props );
	}

	// Event object
	if ( src && src.type ) {
		this.originalEvent = src;
		this.type = src.type;

		// Events bubbling up the document may have been marked as prevented
		// by a handler lower down the tree; reflect the correct value.
		this.isDefaultPrevented = src.defaultPrevented ||
				src.defaultPrevented === undefined &&
				// Support: Android < 4.0
				src.returnValue === false ?
			returnTrue :
			returnFalse;

	// Event type
	} else {
		this.type = src;
	}

	// Put explicitly provided properties onto the event object
	if ( props ) {
		jQuery.extend( this, props );
	}

	// Create a timestamp if incoming event doesn't have one
	this.timeStamp = src && src.timeStamp || jQuery.now();

	// Mark it as fixed
	this[ jQuery.expando ] = true;
};

// jQuery.Event is based on DOM3 Events as specified by the ECMAScript Language Binding
// http://www.w3.org/TR/2003/WD-DOM-Level-3-Events-20030331/ecma-script-binding.html
jQuery.Event.prototype = {
	isDefaultPrevented: returnFalse,
	isPropagationStopped: returnFalse,
	isImmediatePropagationStopped: returnFalse,

	preventDefault: function() {
		var e = this.originalEvent;

		this.isDefaultPrevented = returnTrue;

		if ( e && e.preventDefault ) {
			e.preventDefault();
		}
	},
	stopPropagation: function() {
		var e = this.originalEvent;

		this.isPropagationStopped = returnTrue;

		if ( e && e.stopPropagation ) {
			e.stopPropagation();
		}
	},
	stopImmediatePropagation: function() {
		var e = this.originalEvent;

		this.isImmediatePropagationStopped = returnTrue;

		if ( e && e.stopImmediatePropagation ) {
			e.stopImmediatePropagation();
		}

		this.stopPropagation();
	}
};

// Create mouseenter/leave events using mouseover/out and event-time checks
// Support: Chrome 15+
jQuery.each({
	mouseenter: "mouseover",
	mouseleave: "mouseout",
	pointerenter: "pointerover",
	pointerleave: "pointerout"
}, function( orig, fix ) {
	jQuery.event.special[ orig ] = {
		delegateType: fix,
		bindType: fix,

		handle: function( event ) {
			var ret,
				target = this,
				related = event.relatedTarget,
				handleObj = event.handleObj;

			// For mousenter/leave call the handler if related is outside the target.
			// NB: No relatedTarget if the mouse left/entered the browser window
			if ( !related || (related !== target && !jQuery.contains( target, related )) ) {
				event.type = handleObj.origType;
				ret = handleObj.handler.apply( this, arguments );
				event.type = fix;
			}
			return ret;
		}
	};
});

// Create "bubbling" focus and blur events
// Support: Firefox, Chrome, Safari
if ( !support.focusinBubbles ) {
	jQuery.each({ focus: "focusin", blur: "focusout" }, function( orig, fix ) {

		// Attach a single capturing handler on the document while someone wants focusin/focusout
		var handler = function( event ) {
				jQuery.event.simulate( fix, event.target, jQuery.event.fix( event ), true );
			};

		jQuery.event.special[ fix ] = {
			setup: function() {
				var doc = this.ownerDocument || this,
					attaches = data_priv.access( doc, fix );

				if ( !attaches ) {
					doc.addEventListener( orig, handler, true );
				}
				data_priv.access( doc, fix, ( attaches || 0 ) + 1 );
			},
			teardown: function() {
				var doc = this.ownerDocument || this,
					attaches = data_priv.access( doc, fix ) - 1;

				if ( !attaches ) {
					doc.removeEventListener( orig, handler, true );
					data_priv.remove( doc, fix );

				} else {
					data_priv.access( doc, fix, attaches );
				}
			}
		};
	});
}

jQuery.fn.extend({

	on: function( types, selector, data, fn, /*INTERNAL*/ one ) {
		var origFn, type;

		// Types can be a map of types/handlers
		if ( typeof types === "object" ) {
			// ( types-Object, selector, data )
			if ( typeof selector !== "string" ) {
				// ( types-Object, data )
				data = data || selector;
				selector = undefined;
			}
			for ( type in types ) {
				this.on( type, selector, data, types[ type ], one );
			}
			return this;
		}

		if ( data == null && fn == null ) {
			// ( types, fn )
			fn = selector;
			data = selector = undefined;
		} else if ( fn == null ) {
			if ( typeof selector === "string" ) {
				// ( types, selector, fn )
				fn = data;
				data = undefined;
			} else {
				// ( types, data, fn )
				fn = data;
				data = selector;
				selector = undefined;
			}
		}
		if ( fn === false ) {
			fn = returnFalse;
		} else if ( !fn ) {
			return this;
		}

		if ( one === 1 ) {
			origFn = fn;
			fn = function( event ) {
				// Can use an empty set, since event contains the info
				jQuery().off( event );
				return origFn.apply( this, arguments );
			};
			// Use same guid so caller can remove using origFn
			fn.guid = origFn.guid || ( origFn.guid = jQuery.guid++ );
		}
		return this.each( function() {
			jQuery.event.add( this, types, fn, data, selector );
		});
	},
	one: function( types, selector, data, fn ) {
		return this.on( types, selector, data, fn, 1 );
	},
	off: function( types, selector, fn ) {
		var handleObj, type;
		if ( types && types.preventDefault && types.handleObj ) {
			// ( event )  dispatched jQuery.Event
			handleObj = types.handleObj;
			jQuery( types.delegateTarget ).off(
				handleObj.namespace ? handleObj.origType + "." + handleObj.namespace : handleObj.origType,
				handleObj.selector,
				handleObj.handler
			);
			return this;
		}
		if ( typeof types === "object" ) {
			// ( types-object [, selector] )
			for ( type in types ) {
				this.off( type, selector, types[ type ] );
			}
			return this;
		}
		if ( selector === false || typeof selector === "function" ) {
			// ( types [, fn] )
			fn = selector;
			selector = undefined;
		}
		if ( fn === false ) {
			fn = returnFalse;
		}
		return this.each(function() {
			jQuery.event.remove( this, types, fn, selector );
		});
	},

	trigger: function( type, data ) {
		return this.each(function() {
			jQuery.event.trigger( type, data, this );
		});
	},
	triggerHandler: function( type, data ) {
		var elem = this[0];
		if ( elem ) {
			return jQuery.event.trigger( type, data, elem, true );
		}
	}
});


var
	rxhtmlTag = /<(?!area|br|col|embed|hr|img|input|link|meta|param)(([\w:]+)[^>]*)\/>/gi,
	rtagName = /<([\w:]+)/,
	rhtml = /<|&#?\w+;/,
	rnoInnerhtml = /<(?:script|style|link)/i,
	// checked="checked" or checked
	rchecked = /checked\s*(?:[^=]|=\s*.checked.)/i,
	rscriptType = /^$|\/(?:java|ecma)script/i,
	rscriptTypeMasked = /^true\/(.*)/,
	rcleanScript = /^\s*<!(?:\[CDATA\[|--)|(?:\]\]|--)>\s*$/g,

	// We have to close these tags to support XHTML (#13200)
	wrapMap = {

		// Support: IE 9
		option: [ 1, "<select multiple='multiple'>", "</select>" ],

		thead: [ 1, "<table>", "</table>" ],
		col: [ 2, "<table><colgroup>", "</colgroup></table>" ],
		tr: [ 2, "<table><tbody>", "</tbody></table>" ],
		td: [ 3, "<table><tbody><tr>", "</tr></tbody></table>" ],

		_default: [ 0, "", "" ]
	};

// Support: IE 9
wrapMap.optgroup = wrapMap.option;

wrapMap.tbody = wrapMap.tfoot = wrapMap.colgroup = wrapMap.caption = wrapMap.thead;
wrapMap.th = wrapMap.td;

// Support: 1.x compatibility
// Manipulating tables requires a tbody
function manipulationTarget( elem, content ) {
	return jQuery.nodeName( elem, "table" ) &&
		jQuery.nodeName( content.nodeType !== 11 ? content : content.firstChild, "tr" ) ?

		elem.getElementsByTagName("tbody")[0] ||
			elem.appendChild( elem.ownerDocument.createElement("tbody") ) :
		elem;
}

// Replace/restore the type attribute of script elements for safe DOM manipulation
function disableScript( elem ) {
	elem.type = (elem.getAttribute("type") !== null) + "/" + elem.type;
	return elem;
}
function restoreScript( elem ) {
	var match = rscriptTypeMasked.exec( elem.type );

	if ( match ) {
		elem.type = match[ 1 ];
	} else {
		elem.removeAttribute("type");
	}

	return elem;
}

// Mark scripts as having already been evaluated
function setGlobalEval( elems, refElements ) {
	var i = 0,
		l = elems.length;

	for ( ; i < l; i++ ) {
		data_priv.set(
			elems[ i ], "globalEval", !refElements || data_priv.get( refElements[ i ], "globalEval" )
		);
	}
}

function cloneCopyEvent( src, dest ) {
	var i, l, type, pdataOld, pdataCur, udataOld, udataCur, events;

	if ( dest.nodeType !== 1 ) {
		return;
	}

	// 1. Copy private data: events, handlers, etc.
	if ( data_priv.hasData( src ) ) {
		pdataOld = data_priv.access( src );
		pdataCur = data_priv.set( dest, pdataOld );
		events = pdataOld.events;

		if ( events ) {
			delete pdataCur.handle;
			pdataCur.events = {};

			for ( type in events ) {
				for ( i = 0, l = events[ type ].length; i < l; i++ ) {
					jQuery.event.add( dest, type, events[ type ][ i ] );
				}
			}
		}
	}

	// 2. Copy user data
	if ( data_user.hasData( src ) ) {
		udataOld = data_user.access( src );
		udataCur = jQuery.extend( {}, udataOld );

		data_user.set( dest, udataCur );
	}
}

function getAll( context, tag ) {
	var ret = context.getElementsByTagName ? context.getElementsByTagName( tag || "*" ) :
			context.querySelectorAll ? context.querySelectorAll( tag || "*" ) :
			[];

	return tag === undefined || tag && jQuery.nodeName( context, tag ) ?
		jQuery.merge( [ context ], ret ) :
		ret;
}

// Support: IE >= 9
function fixInput( src, dest ) {
	var nodeName = dest.nodeName.toLowerCase();

	// Fails to persist the checked state of a cloned checkbox or radio button.
	if ( nodeName === "input" && rcheckableType.test( src.type ) ) {
		dest.checked = src.checked;

	// Fails to return the selected option to the default selected state when cloning options
	} else if ( nodeName === "input" || nodeName === "textarea" ) {
		dest.defaultValue = src.defaultValue;
	}
}

jQuery.extend({
	clone: function( elem, dataAndEvents, deepDataAndEvents ) {
		var i, l, srcElements, destElements,
			clone = elem.cloneNode( true ),
			inPage = jQuery.contains( elem.ownerDocument, elem );

		// Support: IE >= 9
		// Fix Cloning issues
		if ( !support.noCloneChecked && ( elem.nodeType === 1 || elem.nodeType === 11 ) &&
				!jQuery.isXMLDoc( elem ) ) {

			// We eschew Sizzle here for performance reasons: http://jsperf.com/getall-vs-sizzle/2
			destElements = getAll( clone );
			srcElements = getAll( elem );

			for ( i = 0, l = srcElements.length; i < l; i++ ) {
				fixInput( srcElements[ i ], destElements[ i ] );
			}
		}

		// Copy the events from the original to the clone
		if ( dataAndEvents ) {
			if ( deepDataAndEvents ) {
				srcElements = srcElements || getAll( elem );
				destElements = destElements || getAll( clone );

				for ( i = 0, l = srcElements.length; i < l; i++ ) {
					cloneCopyEvent( srcElements[ i ], destElements[ i ] );
				}
			} else {
				cloneCopyEvent( elem, clone );
			}
		}

		// Preserve script evaluation history
		destElements = getAll( clone, "script" );
		if ( destElements.length > 0 ) {
			setGlobalEval( destElements, !inPage && getAll( elem, "script" ) );
		}

		// Return the cloned set
		return clone;
	},

	buildFragment: function( elems, context, scripts, selection ) {
		var elem, tmp, tag, wrap, contains, j,
			fragment = context.createDocumentFragment(),
			nodes = [],
			i = 0,
			l = elems.length;

		for ( ; i < l; i++ ) {
			elem = elems[ i ];

			if ( elem || elem === 0 ) {

				// Add nodes directly
				if ( jQuery.type( elem ) === "object" ) {
					// Support: QtWebKit
					// jQuery.merge because push.apply(_, arraylike) throws
					jQuery.merge( nodes, elem.nodeType ? [ elem ] : elem );

				// Convert non-html into a text node
				} else if ( !rhtml.test( elem ) ) {
					nodes.push( context.createTextNode( elem ) );

				// Convert html into DOM nodes
				} else {
					tmp = tmp || fragment.appendChild( context.createElement("div") );

					// Deserialize a standard representation
					tag = ( rtagName.exec( elem ) || [ "", "" ] )[ 1 ].toLowerCase();
					wrap = wrapMap[ tag ] || wrapMap._default;
					tmp.innerHTML = wrap[ 1 ] + elem.replace( rxhtmlTag, "<$1></$2>" ) + wrap[ 2 ];

					// Descend through wrappers to the right content
					j = wrap[ 0 ];
					while ( j-- ) {
						tmp = tmp.lastChild;
					}

					// Support: QtWebKit
					// jQuery.merge because push.apply(_, arraylike) throws
					jQuery.merge( nodes, tmp.childNodes );

					// Remember the top-level container
					tmp = fragment.firstChild;

					// Fixes #12346
					// Support: Webkit, IE
					tmp.textContent = "";
				}
			}
		}

		// Remove wrapper from fragment
		fragment.textContent = "";

		i = 0;
		while ( (elem = nodes[ i++ ]) ) {

			// #4087 - If origin and destination elements are the same, and this is
			// that element, do not do anything
			if ( selection && jQuery.inArray( elem, selection ) !== -1 ) {
				continue;
			}

			contains = jQuery.contains( elem.ownerDocument, elem );

			// Append to fragment
			tmp = getAll( fragment.appendChild( elem ), "script" );

			// Preserve script evaluation history
			if ( contains ) {
				setGlobalEval( tmp );
			}

			// Capture executables
			if ( scripts ) {
				j = 0;
				while ( (elem = tmp[ j++ ]) ) {
					if ( rscriptType.test( elem.type || "" ) ) {
						scripts.push( elem );
					}
				}
			}
		}

		return fragment;
	},

	cleanData: function( elems ) {
		var data, elem, type, key,
			special = jQuery.event.special,
			i = 0;

		for ( ; (elem = elems[ i ]) !== undefined; i++ ) {
			if ( jQuery.acceptData( elem ) ) {
				key = elem[ data_priv.expando ];

				if ( key && (data = data_priv.cache[ key ]) ) {
					if ( data.events ) {
						for ( type in data.events ) {
							if ( special[ type ] ) {
								jQuery.event.remove( elem, type );

							// This is a shortcut to avoid jQuery.event.remove's overhead
							} else {
								jQuery.removeEvent( elem, type, data.handle );
							}
						}
					}
					if ( data_priv.cache[ key ] ) {
						// Discard any remaining `private` data
						delete data_priv.cache[ key ];
					}
				}
			}
			// Discard any remaining `user` data
			delete data_user.cache[ elem[ data_user.expando ] ];
		}
	}
});

jQuery.fn.extend({
	text: function( value ) {
		return access( this, function( value ) {
			return value === undefined ?
				jQuery.text( this ) :
				this.empty().each(function() {
					if ( this.nodeType === 1 || this.nodeType === 11 || this.nodeType === 9 ) {
						this.textContent = value;
					}
				});
		}, null, value, arguments.length );
	},

	append: function() {
		return this.domManip( arguments, function( elem ) {
			if ( this.nodeType === 1 || this.nodeType === 11 || this.nodeType === 9 ) {
				var target = manipulationTarget( this, elem );
				target.appendChild( elem );
			}
		});
	},

	prepend: function() {
		return this.domManip( arguments, function( elem ) {
			if ( this.nodeType === 1 || this.nodeType === 11 || this.nodeType === 9 ) {
				var target = manipulationTarget( this, elem );
				target.insertBefore( elem, target.firstChild );
			}
		});
	},

	before: function() {
		return this.domManip( arguments, function( elem ) {
			if ( this.parentNode ) {
				this.parentNode.insertBefore( elem, this );
			}
		});
	},

	after: function() {
		return this.domManip( arguments, function( elem ) {
			if ( this.parentNode ) {
				this.parentNode.insertBefore( elem, this.nextSibling );
			}
		});
	},

	remove: function( selector, keepData /* Internal Use Only */ ) {
		var elem,
			elems = selector ? jQuery.filter( selector, this ) : this,
			i = 0;

		for ( ; (elem = elems[i]) != null; i++ ) {
			if ( !keepData && elem.nodeType === 1 ) {
				jQuery.cleanData( getAll( elem ) );
			}

			if ( elem.parentNode ) {
				if ( keepData && jQuery.contains( elem.ownerDocument, elem ) ) {
					setGlobalEval( getAll( elem, "script" ) );
				}
				elem.parentNode.removeChild( elem );
			}
		}

		return this;
	},

	empty: function() {
		var elem,
			i = 0;

		for ( ; (elem = this[i]) != null; i++ ) {
			if ( elem.nodeType === 1 ) {

				// Prevent memory leaks
				jQuery.cleanData( getAll( elem, false ) );

				// Remove any remaining nodes
				elem.textContent = "";
			}
		}

		return this;
	},

	clone: function( dataAndEvents, deepDataAndEvents ) {
		dataAndEvents = dataAndEvents == null ? false : dataAndEvents;
		deepDataAndEvents = deepDataAndEvents == null ? dataAndEvents : deepDataAndEvents;

		return this.map(function() {
			return jQuery.clone( this, dataAndEvents, deepDataAndEvents );
		});
	},

	html: function( value ) {
		return access( this, function( value ) {
			var elem = this[ 0 ] || {},
				i = 0,
				l = this.length;

			if ( value === undefined && elem.nodeType === 1 ) {
				return elem.innerHTML;
			}

			// See if we can take a shortcut and just use innerHTML
			if ( typeof value === "string" && !rnoInnerhtml.test( value ) &&
				!wrapMap[ ( rtagName.exec( value ) || [ "", "" ] )[ 1 ].toLowerCase() ] ) {

				value = value.replace( rxhtmlTag, "<$1></$2>" );

				try {
					for ( ; i < l; i++ ) {
						elem = this[ i ] || {};

						// Remove element nodes and prevent memory leaks
						if ( elem.nodeType === 1 ) {
							jQuery.cleanData( getAll( elem, false ) );
							elem.innerHTML = value;
						}
					}

					elem = 0;

				// If using innerHTML throws an exception, use the fallback method
				} catch( e ) {}
			}

			if ( elem ) {
				this.empty().append( value );
			}
		}, null, value, arguments.length );
	},

	replaceWith: function() {
		var arg = arguments[ 0 ];

		// Make the changes, replacing each context element with the new content
		this.domManip( arguments, function( elem ) {
			arg = this.parentNode;

			jQuery.cleanData( getAll( this ) );

			if ( arg ) {
				arg.replaceChild( elem, this );
			}
		});

		// Force removal if there was no new content (e.g., from empty arguments)
		return arg && (arg.length || arg.nodeType) ? this : this.remove();
	},

	detach: function( selector ) {
		return this.remove( selector, true );
	},

	domManip: function( args, callback ) {

		// Flatten any nested arrays
		args = concat.apply( [], args );

		var fragment, first, scripts, hasScripts, node, doc,
			i = 0,
			l = this.length,
			set = this,
			iNoClone = l - 1,
			value = args[ 0 ],
			isFunction = jQuery.isFunction( value );

		// We can't cloneNode fragments that contain checked, in WebKit
		if ( isFunction ||
				( l > 1 && typeof value === "string" &&
					!support.checkClone && rchecked.test( value ) ) ) {
			return this.each(function( index ) {
				var self = set.eq( index );
				if ( isFunction ) {
					args[ 0 ] = value.call( this, index, self.html() );
				}
				self.domManip( args, callback );
			});
		}

		if ( l ) {
			fragment = jQuery.buildFragment( args, this[ 0 ].ownerDocument, false, this );
			first = fragment.firstChild;

			if ( fragment.childNodes.length === 1 ) {
				fragment = first;
			}

			if ( first ) {
				scripts = jQuery.map( getAll( fragment, "script" ), disableScript );
				hasScripts = scripts.length;

				// Use the original fragment for the last item instead of the first because it can end up
				// being emptied incorrectly in certain situations (#8070).
				for ( ; i < l; i++ ) {
					node = fragment;

					if ( i !== iNoClone ) {
						node = jQuery.clone( node, true, true );

						// Keep references to cloned scripts for later restoration
						if ( hasScripts ) {
							// Support: QtWebKit
							// jQuery.merge because push.apply(_, arraylike) throws
							jQuery.merge( scripts, getAll( node, "script" ) );
						}
					}

					callback.call( this[ i ], node, i );
				}

				if ( hasScripts ) {
					doc = scripts[ scripts.length - 1 ].ownerDocument;

					// Reenable scripts
					jQuery.map( scripts, restoreScript );

					// Evaluate executable scripts on first document insertion
					for ( i = 0; i < hasScripts; i++ ) {
						node = scripts[ i ];
						if ( rscriptType.test( node.type || "" ) &&
							!data_priv.access( node, "globalEval" ) && jQuery.contains( doc, node ) ) {

							if ( node.src ) {
								// Optional AJAX dependency, but won't run scripts if not present
								if ( jQuery._evalUrl ) {
									jQuery._evalUrl( node.src );
								}
							} else {
								jQuery.globalEval( node.textContent.replace( rcleanScript, "" ) );
							}
						}
					}
				}
			}
		}

		return this;
	}
});

jQuery.each({
	appendTo: "append",
	prependTo: "prepend",
	insertBefore: "before",
	insertAfter: "after",
	replaceAll: "replaceWith"
}, function( name, original ) {
	jQuery.fn[ name ] = function( selector ) {
		var elems,
			ret = [],
			insert = jQuery( selector ),
			last = insert.length - 1,
			i = 0;

		for ( ; i <= last; i++ ) {
			elems = i === last ? this : this.clone( true );
			jQuery( insert[ i ] )[ original ]( elems );

			// Support: QtWebKit
			// .get() because push.apply(_, arraylike) throws
			push.apply( ret, elems.get() );
		}

		return this.pushStack( ret );
	};
});


var iframe,
	elemdisplay = {};

/**
 * Retrieve the actual display of a element
 * @param {String} name nodeName of the element
 * @param {Object} doc Document object
 */
// Called only from within defaultDisplay
function actualDisplay( name, doc ) {
	var style,
		elem = jQuery( doc.createElement( name ) ).appendTo( doc.body ),

		// getDefaultComputedStyle might be reliably used only on attached element
		display = window.getDefaultComputedStyle && ( style = window.getDefaultComputedStyle( elem[ 0 ] ) ) ?

			// Use of this method is a temporary fix (more like optmization) until something better comes along,
			// since it was removed from specification and supported only in FF
			style.display : jQuery.css( elem[ 0 ], "display" );

	// We don't have any data stored on the element,
	// so use "detach" method as fast way to get rid of the element
	elem.detach();

	return display;
}

/**
 * Try to determine the default display value of an element
 * @param {String} nodeName
 */
function defaultDisplay( nodeName ) {
	var doc = document,
		display = elemdisplay[ nodeName ];

	if ( !display ) {
		display = actualDisplay( nodeName, doc );

		// If the simple way fails, read from inside an iframe
		if ( display === "none" || !display ) {

			// Use the already-created iframe if possible
			iframe = (iframe || jQuery( "<iframe frameborder='0' width='0' height='0'/>" )).appendTo( doc.documentElement );

			// Always write a new HTML skeleton so Webkit and Firefox don't choke on reuse
			doc = iframe[ 0 ].contentDocument;

			// Support: IE
			doc.write();
			doc.close();

			display = actualDisplay( nodeName, doc );
			iframe.detach();
		}

		// Store the correct default display
		elemdisplay[ nodeName ] = display;
	}

	return display;
}
var rmargin = (/^margin/);

var rnumnonpx = new RegExp( "^(" + pnum + ")(?!px)[a-z%]+$", "i" );

var getStyles = function( elem ) {
		return elem.ownerDocument.defaultView.getComputedStyle( elem, null );
	};



function curCSS( elem, name, computed ) {
	var width, minWidth, maxWidth, ret,
		style = elem.style;

	computed = computed || getStyles( elem );

	// Support: IE9
	// getPropertyValue is only needed for .css('filter') in IE9, see #12537
	if ( computed ) {
		ret = computed.getPropertyValue( name ) || computed[ name ];
	}

	if ( computed ) {

		if ( ret === "" && !jQuery.contains( elem.ownerDocument, elem ) ) {
			ret = jQuery.style( elem, name );
		}

		// Support: iOS < 6
		// A tribute to the "awesome hack by Dean Edwards"
		// iOS < 6 (at least) returns percentage for a larger set of values, but width seems to be reliably pixels
		// this is against the CSSOM draft spec: http://dev.w3.org/csswg/cssom/#resolved-values
		if ( rnumnonpx.test( ret ) && rmargin.test( name ) ) {

			// Remember the original values
			width = style.width;
			minWidth = style.minWidth;
			maxWidth = style.maxWidth;

			// Put in the new values to get a computed value out
			style.minWidth = style.maxWidth = style.width = ret;
			ret = computed.width;

			// Revert the changed values
			style.width = width;
			style.minWidth = minWidth;
			style.maxWidth = maxWidth;
		}
	}

	return ret !== undefined ?
		// Support: IE
		// IE returns zIndex value as an integer.
		ret + "" :
		ret;
}


function addGetHookIf( conditionFn, hookFn ) {
	// Define the hook, we'll check on the first run if it's really needed.
	return {
		get: function() {
			if ( conditionFn() ) {
				// Hook not needed (or it's not possible to use it due to missing dependency),
				// remove it.
				// Since there are no other hooks for marginRight, remove the whole object.
				delete this.get;
				return;
			}

			// Hook needed; redefine it so that the support test is not executed again.

			return (this.get = hookFn).apply( this, arguments );
		}
	};
}


(function() {
	var pixelPositionVal, boxSizingReliableVal,
		docElem = document.documentElement,
		container = document.createElement( "div" ),
		div = document.createElement( "div" );

	if ( !div.style ) {
		return;
	}

	div.style.backgroundClip = "content-box";
	div.cloneNode( true ).style.backgroundClip = "";
	support.clearCloneStyle = div.style.backgroundClip === "content-box";

	container.style.cssText = "border:0;width:0;height:0;top:0;left:-9999px;margin-top:1px;" +
		"position:absolute";
	container.appendChild( div );

	// Executing both pixelPosition & boxSizingReliable tests require only one layout
	// so they're executed at the same time to save the second computation.
	function computePixelPositionAndBoxSizingReliable() {
		div.style.cssText =
			// Support: Firefox<29, Android 2.3
			// Vendor-prefix box-sizing
			"-webkit-box-sizing:border-box;-moz-box-sizing:border-box;" +
			"box-sizing:border-box;display:block;margin-top:1%;top:1%;" +
			"border:1px;padding:1px;width:4px;position:absolute";
		div.innerHTML = "";
		docElem.appendChild( container );

		var divStyle = window.getComputedStyle( div, null );
		pixelPositionVal = divStyle.top !== "1%";
		boxSizingReliableVal = divStyle.width === "4px";

		docElem.removeChild( container );
	}

	// Support: node.js jsdom
	// Don't assume that getComputedStyle is a property of the global object
	if ( window.getComputedStyle ) {
		jQuery.extend( support, {
			pixelPosition: function() {
				// This test is executed only once but we still do memoizing
				// since we can use the boxSizingReliable pre-computing.
				// No need to check if the test was already performed, though.
				computePixelPositionAndBoxSizingReliable();
				return pixelPositionVal;
			},
			boxSizingReliable: function() {
				if ( boxSizingReliableVal == null ) {
					computePixelPositionAndBoxSizingReliable();
				}
				return boxSizingReliableVal;
			},
			reliableMarginRight: function() {
				// Support: Android 2.3
				// Check if div with explicit width and no margin-right incorrectly
				// gets computed margin-right based on width of container. (#3333)
				// WebKit Bug 13343 - getComputedStyle returns wrong value for margin-right
				// This support function is only executed once so no memoizing is needed.
				var ret,
					marginDiv = div.appendChild( document.createElement( "div" ) );

				// Reset CSS: box-sizing; display; margin; border; padding
				marginDiv.style.cssText = div.style.cssText =
					// Support: Firefox<29, Android 2.3
					// Vendor-prefix box-sizing
					"-webkit-box-sizing:content-box;-moz-box-sizing:content-box;" +
					"box-sizing:content-box;display:block;margin:0;border:0;padding:0";
				marginDiv.style.marginRight = marginDiv.style.width = "0";
				div.style.width = "1px";
				docElem.appendChild( container );

				ret = !parseFloat( window.getComputedStyle( marginDiv, null ).marginRight );

				docElem.removeChild( container );

				return ret;
			}
		});
	}
})();


// A method for quickly swapping in/out CSS properties to get correct calculations.
jQuery.swap = function( elem, options, callback, args ) {
	var ret, name,
		old = {};

	// Remember the old values, and insert the new ones
	for ( name in options ) {
		old[ name ] = elem.style[ name ];
		elem.style[ name ] = options[ name ];
	}

	ret = callback.apply( elem, args || [] );

	// Revert the old values
	for ( name in options ) {
		elem.style[ name ] = old[ name ];
	}

	return ret;
};


var
	// swappable if display is none or starts with table except "table", "table-cell", or "table-caption"
	// see here for display values: https://developer.mozilla.org/en-US/docs/CSS/display
	rdisplayswap = /^(none|table(?!-c[ea]).+)/,
	rnumsplit = new RegExp( "^(" + pnum + ")(.*)$", "i" ),
	rrelNum = new RegExp( "^([+-])=(" + pnum + ")", "i" ),

	cssShow = { position: "absolute", visibility: "hidden", display: "block" },
	cssNormalTransform = {
		letterSpacing: "0",
		fontWeight: "400"
	},

	cssPrefixes = [ "Webkit", "O", "Moz", "ms" ];

// return a css property mapped to a potentially vendor prefixed property
function vendorPropName( style, name ) {

	// shortcut for names that are not vendor prefixed
	if ( name in style ) {
		return name;
	}

	// check for vendor prefixed names
	var capName = name[0].toUpperCase() + name.slice(1),
		origName = name,
		i = cssPrefixes.length;

	while ( i-- ) {
		name = cssPrefixes[ i ] + capName;
		if ( name in style ) {
			return name;
		}
	}

	return origName;
}

function setPositiveNumber( elem, value, subtract ) {
	var matches = rnumsplit.exec( value );
	return matches ?
		// Guard against undefined "subtract", e.g., when used as in cssHooks
		Math.max( 0, matches[ 1 ] - ( subtract || 0 ) ) + ( matches[ 2 ] || "px" ) :
		value;
}

function augmentWidthOrHeight( elem, name, extra, isBorderBox, styles ) {
	var i = extra === ( isBorderBox ? "border" : "content" ) ?
		// If we already have the right measurement, avoid augmentation
		4 :
		// Otherwise initialize for horizontal or vertical properties
		name === "width" ? 1 : 0,

		val = 0;

	for ( ; i < 4; i += 2 ) {
		// both box models exclude margin, so add it if we want it
		if ( extra === "margin" ) {
			val += jQuery.css( elem, extra + cssExpand[ i ], true, styles );
		}

		if ( isBorderBox ) {
			// border-box includes padding, so remove it if we want content
			if ( extra === "content" ) {
				val -= jQuery.css( elem, "padding" + cssExpand[ i ], true, styles );
			}

			// at this point, extra isn't border nor margin, so remove border
			if ( extra !== "margin" ) {
				val -= jQuery.css( elem, "border" + cssExpand[ i ] + "Width", true, styles );
			}
		} else {
			// at this point, extra isn't content, so add padding
			val += jQuery.css( elem, "padding" + cssExpand[ i ], true, styles );

			// at this point, extra isn't content nor padding, so add border
			if ( extra !== "padding" ) {
				val += jQuery.css( elem, "border" + cssExpand[ i ] + "Width", true, styles );
			}
		}
	}

	return val;
}

function getWidthOrHeight( elem, name, extra ) {

	// Start with offset property, which is equivalent to the border-box value
	var valueIsBorderBox = true,
		val = name === "width" ? elem.offsetWidth : elem.offsetHeight,
		styles = getStyles( elem ),
		isBorderBox = jQuery.css( elem, "boxSizing", false, styles ) === "border-box";

	// some non-html elements return undefined for offsetWidth, so check for null/undefined
	// svg - https://bugzilla.mozilla.org/show_bug.cgi?id=649285
	// MathML - https://bugzilla.mozilla.org/show_bug.cgi?id=491668
	if ( val <= 0 || val == null ) {
		// Fall back to computed then uncomputed css if necessary
		val = curCSS( elem, name, styles );
		if ( val < 0 || val == null ) {
			val = elem.style[ name ];
		}

		// Computed unit is not pixels. Stop here and return.
		if ( rnumnonpx.test(val) ) {
			return val;
		}

		// we need the check for style in case a browser which returns unreliable values
		// for getComputedStyle silently falls back to the reliable elem.style
		valueIsBorderBox = isBorderBox &&
			( support.boxSizingReliable() || val === elem.style[ name ] );

		// Normalize "", auto, and prepare for extra
		val = parseFloat( val ) || 0;
	}

	// use the active box-sizing model to add/subtract irrelevant styles
	return ( val +
		augmentWidthOrHeight(
			elem,
			name,
			extra || ( isBorderBox ? "border" : "content" ),
			valueIsBorderBox,
			styles
		)
	) + "px";
}

function showHide( elements, show ) {
	var display, elem, hidden,
		values = [],
		index = 0,
		length = elements.length;

	for ( ; index < length; index++ ) {
		elem = elements[ index ];
		if ( !elem.style ) {
			continue;
		}

		values[ index ] = data_priv.get( elem, "olddisplay" );
		display = elem.style.display;
		if ( show ) {
			// Reset the inline display of this element to learn if it is
			// being hidden by cascaded rules or not
			if ( !values[ index ] && display === "none" ) {
				elem.style.display = "";
			}

			// Set elements which have been overridden with display: none
			// in a stylesheet to whatever the default browser style is
			// for such an element
			if ( elem.style.display === "" && isHidden( elem ) ) {
				values[ index ] = data_priv.access( elem, "olddisplay", defaultDisplay(elem.nodeName) );
			}
		} else {
			hidden = isHidden( elem );

			if ( display !== "none" || !hidden ) {
				data_priv.set( elem, "olddisplay", hidden ? display : jQuery.css( elem, "display" ) );
			}
		}
	}

	// Set the display of most of the elements in a second loop
	// to avoid the constant reflow
	for ( index = 0; index < length; index++ ) {
		elem = elements[ index ];
		if ( !elem.style ) {
			continue;
		}
		if ( !show || elem.style.display === "none" || elem.style.display === "" ) {
			elem.style.display = show ? values[ index ] || "" : "none";
		}
	}

	return elements;
}

jQuery.extend({
	// Add in style property hooks for overriding the default
	// behavior of getting and setting a style property
	cssHooks: {
		opacity: {
			get: function( elem, computed ) {
				if ( computed ) {
					// We should always get a number back from opacity
					var ret = curCSS( elem, "opacity" );
					return ret === "" ? "1" : ret;
				}
			}
		}
	},

	// Don't automatically add "px" to these possibly-unitless properties
	cssNumber: {
		"columnCount": true,
		"fillOpacity": true,
		"flexGrow": true,
		"flexShrink": true,
		"fontWeight": true,
		"lineHeight": true,
		"opacity": true,
		"order": true,
		"orphans": true,
		"widows": true,
		"zIndex": true,
		"zoom": true
	},

	// Add in properties whose names you wish to fix before
	// setting or getting the value
	cssProps: {
		// normalize float css property
		"float": "cssFloat"
	},

	// Get and set the style property on a DOM Node
	style: function( elem, name, value, extra ) {
		// Don't set styles on text and comment nodes
		if ( !elem || elem.nodeType === 3 || elem.nodeType === 8 || !elem.style ) {
			return;
		}

		// Make sure that we're working with the right name
		var ret, type, hooks,
			origName = jQuery.camelCase( name ),
			style = elem.style;

		name = jQuery.cssProps[ origName ] || ( jQuery.cssProps[ origName ] = vendorPropName( style, origName ) );

		// gets hook for the prefixed version
		// followed by the unprefixed version
		hooks = jQuery.cssHooks[ name ] || jQuery.cssHooks[ origName ];

		// Check if we're setting a value
		if ( value !== undefined ) {
			type = typeof value;

			// convert relative number strings (+= or -=) to relative numbers. #7345
			if ( type === "string" && (ret = rrelNum.exec( value )) ) {
				value = ( ret[1] + 1 ) * ret[2] + parseFloat( jQuery.css( elem, name ) );
				// Fixes bug #9237
				type = "number";
			}

			// Make sure that null and NaN values aren't set. See: #7116
			if ( value == null || value !== value ) {
				return;
			}

			// If a number was passed in, add 'px' to the (except for certain CSS properties)
			if ( type === "number" && !jQuery.cssNumber[ origName ] ) {
				value += "px";
			}

			// Fixes #8908, it can be done more correctly by specifying setters in cssHooks,
			// but it would mean to define eight (for every problematic property) identical functions
			if ( !support.clearCloneStyle && value === "" && name.indexOf( "background" ) === 0 ) {
				style[ name ] = "inherit";
			}

			// If a hook was provided, use that value, otherwise just set the specified value
			if ( !hooks || !("set" in hooks) || (value = hooks.set( elem, value, extra )) !== undefined ) {
				style[ name ] = value;
			}

		} else {
			// If a hook was provided get the non-computed value from there
			if ( hooks && "get" in hooks && (ret = hooks.get( elem, false, extra )) !== undefined ) {
				return ret;
			}

			// Otherwise just get the value from the style object
			return style[ name ];
		}
	},

	css: function( elem, name, extra, styles ) {
		var val, num, hooks,
			origName = jQuery.camelCase( name );

		// Make sure that we're working with the right name
		name = jQuery.cssProps[ origName ] || ( jQuery.cssProps[ origName ] = vendorPropName( elem.style, origName ) );

		// gets hook for the prefixed version
		// followed by the unprefixed version
		hooks = jQuery.cssHooks[ name ] || jQuery.cssHooks[ origName ];

		// If a hook was provided get the computed value from there
		if ( hooks && "get" in hooks ) {
			val = hooks.get( elem, true, extra );
		}

		// Otherwise, if a way to get the computed value exists, use that
		if ( val === undefined ) {
			val = curCSS( elem, name, styles );
		}

		//convert "normal" to computed value
		if ( val === "normal" && name in cssNormalTransform ) {
			val = cssNormalTransform[ name ];
		}

		// Return, converting to number if forced or a qualifier was provided and val looks numeric
		if ( extra === "" || extra ) {
			num = parseFloat( val );
			return extra === true || jQuery.isNumeric( num ) ? num || 0 : val;
		}
		return val;
	}
});

jQuery.each([ "height", "width" ], function( i, name ) {
	jQuery.cssHooks[ name ] = {
		get: function( elem, computed, extra ) {
			if ( computed ) {
				// certain elements can have dimension info if we invisibly show them
				// however, it must have a current display style that would benefit from this
				return rdisplayswap.test( jQuery.css( elem, "display" ) ) && elem.offsetWidth === 0 ?
					jQuery.swap( elem, cssShow, function() {
						return getWidthOrHeight( elem, name, extra );
					}) :
					getWidthOrHeight( elem, name, extra );
			}
		},

		set: function( elem, value, extra ) {
			var styles = extra && getStyles( elem );
			return setPositiveNumber( elem, value, extra ?
				augmentWidthOrHeight(
					elem,
					name,
					extra,
					jQuery.css( elem, "boxSizing", false, styles ) === "border-box",
					styles
				) : 0
			);
		}
	};
});

// Support: Android 2.3
jQuery.cssHooks.marginRight = addGetHookIf( support.reliableMarginRight,
	function( elem, computed ) {
		if ( computed ) {
			// WebKit Bug 13343 - getComputedStyle returns wrong value for margin-right
			// Work around by temporarily setting element display to inline-block
			return jQuery.swap( elem, { "display": "inline-block" },
				curCSS, [ elem, "marginRight" ] );
		}
	}
);

// These hooks are used by animate to expand properties
jQuery.each({
	margin: "",
	padding: "",
	border: "Width"
}, function( prefix, suffix ) {
	jQuery.cssHooks[ prefix + suffix ] = {
		expand: function( value ) {
			var i = 0,
				expanded = {},

				// assumes a single number if not a string
				parts = typeof value === "string" ? value.split(" ") : [ value ];

			for ( ; i < 4; i++ ) {
				expanded[ prefix + cssExpand[ i ] + suffix ] =
					parts[ i ] || parts[ i - 2 ] || parts[ 0 ];
			}

			return expanded;
		}
	};

	if ( !rmargin.test( prefix ) ) {
		jQuery.cssHooks[ prefix + suffix ].set = setPositiveNumber;
	}
});

jQuery.fn.extend({
	css: function( name, value ) {
		return access( this, function( elem, name, value ) {
			var styles, len,
				map = {},
				i = 0;

			if ( jQuery.isArray( name ) ) {
				styles = getStyles( elem );
				len = name.length;

				for ( ; i < len; i++ ) {
					map[ name[ i ] ] = jQuery.css( elem, name[ i ], false, styles );
				}

				return map;
			}

			return value !== undefined ?
				jQuery.style( elem, name, value ) :
				jQuery.css( elem, name );
		}, name, value, arguments.length > 1 );
	},
	show: function() {
		return showHide( this, true );
	},
	hide: function() {
		return showHide( this );
	},
	toggle: function( state ) {
		if ( typeof state === "boolean" ) {
			return state ? this.show() : this.hide();
		}

		return this.each(function() {
			if ( isHidden( this ) ) {
				jQuery( this ).show();
			} else {
				jQuery( this ).hide();
			}
		});
	}
});


function Tween( elem, options, prop, end, easing ) {
	return new Tween.prototype.init( elem, options, prop, end, easing );
}
jQuery.Tween = Tween;

Tween.prototype = {
	constructor: Tween,
	init: function( elem, options, prop, end, easing, unit ) {
		this.elem = elem;
		this.prop = prop;
		this.easing = easing || "swing";
		this.options = options;
		this.start = this.now = this.cur();
		this.end = end;
		this.unit = unit || ( jQuery.cssNumber[ prop ] ? "" : "px" );
	},
	cur: function() {
		var hooks = Tween.propHooks[ this.prop ];

		return hooks && hooks.get ?
			hooks.get( this ) :
			Tween.propHooks._default.get( this );
	},
	run: function( percent ) {
		var eased,
			hooks = Tween.propHooks[ this.prop ];

		if ( this.options.duration ) {
			this.pos = eased = jQuery.easing[ this.easing ](
				percent, this.options.duration * percent, 0, 1, this.options.duration
			);
		} else {
			this.pos = eased = percent;
		}
		this.now = ( this.end - this.start ) * eased + this.start;

		if ( this.options.step ) {
			this.options.step.call( this.elem, this.now, this );
		}

		if ( hooks && hooks.set ) {
			hooks.set( this );
		} else {
			Tween.propHooks._default.set( this );
		}
		return this;
	}
};

Tween.prototype.init.prototype = Tween.prototype;

Tween.propHooks = {
	_default: {
		get: function( tween ) {
			var result;

			if ( tween.elem[ tween.prop ] != null &&
				(!tween.elem.style || tween.elem.style[ tween.prop ] == null) ) {
				return tween.elem[ tween.prop ];
			}

			// passing an empty string as a 3rd parameter to .css will automatically
			// attempt a parseFloat and fallback to a string if the parse fails
			// so, simple values such as "10px" are parsed to Float.
			// complex values such as "rotate(1rad)" are returned as is.
			result = jQuery.css( tween.elem, tween.prop, "" );
			// Empty strings, null, undefined and "auto" are converted to 0.
			return !result || result === "auto" ? 0 : result;
		},
		set: function( tween ) {
			// use step hook for back compat - use cssHook if its there - use .style if its
			// available and use plain properties where available
			if ( jQuery.fx.step[ tween.prop ] ) {
				jQuery.fx.step[ tween.prop ]( tween );
			} else if ( tween.elem.style && ( tween.elem.style[ jQuery.cssProps[ tween.prop ] ] != null || jQuery.cssHooks[ tween.prop ] ) ) {
				jQuery.style( tween.elem, tween.prop, tween.now + tween.unit );
			} else {
				tween.elem[ tween.prop ] = tween.now;
			}
		}
	}
};

// Support: IE9
// Panic based approach to setting things on disconnected nodes

Tween.propHooks.scrollTop = Tween.propHooks.scrollLeft = {
	set: function( tween ) {
		if ( tween.elem.nodeType && tween.elem.parentNode ) {
			tween.elem[ tween.prop ] = tween.now;
		}
	}
};

jQuery.easing = {
	linear: function( p ) {
		return p;
	},
	swing: function( p ) {
		return 0.5 - Math.cos( p * Math.PI ) / 2;
	}
};

jQuery.fx = Tween.prototype.init;

// Back Compat <1.8 extension point
jQuery.fx.step = {};




var
	fxNow, timerId,
	rfxtypes = /^(?:toggle|show|hide)$/,
	rfxnum = new RegExp( "^(?:([+-])=|)(" + pnum + ")([a-z%]*)$", "i" ),
	rrun = /queueHooks$/,
	animationPrefilters = [ defaultPrefilter ],
	tweeners = {
		"*": [ function( prop, value ) {
			var tween = this.createTween( prop, value ),
				target = tween.cur(),
				parts = rfxnum.exec( value ),
				unit = parts && parts[ 3 ] || ( jQuery.cssNumber[ prop ] ? "" : "px" ),

				// Starting value computation is required for potential unit mismatches
				start = ( jQuery.cssNumber[ prop ] || unit !== "px" && +target ) &&
					rfxnum.exec( jQuery.css( tween.elem, prop ) ),
				scale = 1,
				maxIterations = 20;

			if ( start && start[ 3 ] !== unit ) {
				// Trust units reported by jQuery.css
				unit = unit || start[ 3 ];

				// Make sure we update the tween properties later on
				parts = parts || [];

				// Iteratively approximate from a nonzero starting point
				start = +target || 1;

				do {
					// If previous iteration zeroed out, double until we get *something*
					// Use a string for doubling factor so we don't accidentally see scale as unchanged below
					scale = scale || ".5";

					// Adjust and apply
					start = start / scale;
					jQuery.style( tween.elem, prop, start + unit );

				// Update scale, tolerating zero or NaN from tween.cur()
				// And breaking the loop if scale is unchanged or perfect, or if we've just had enough
				} while ( scale !== (scale = tween.cur() / target) && scale !== 1 && --maxIterations );
			}

			// Update tween properties
			if ( parts ) {
				start = tween.start = +start || +target || 0;
				tween.unit = unit;
				// If a +=/-= token was provided, we're doing a relative animation
				tween.end = parts[ 1 ] ?
					start + ( parts[ 1 ] + 1 ) * parts[ 2 ] :
					+parts[ 2 ];
			}

			return tween;
		} ]
	};

// Animations created synchronously will run synchronously
function createFxNow() {
	setTimeout(function() {
		fxNow = undefined;
	});
	return ( fxNow = jQuery.now() );
}

// Generate parameters to create a standard animation
function genFx( type, includeWidth ) {
	var which,
		i = 0,
		attrs = { height: type };

	// if we include width, step value is 1 to do all cssExpand values,
	// if we don't include width, step value is 2 to skip over Left and Right
	includeWidth = includeWidth ? 1 : 0;
	for ( ; i < 4 ; i += 2 - includeWidth ) {
		which = cssExpand[ i ];
		attrs[ "margin" + which ] = attrs[ "padding" + which ] = type;
	}

	if ( includeWidth ) {
		attrs.opacity = attrs.width = type;
	}

	return attrs;
}

function createTween( value, prop, animation ) {
	var tween,
		collection = ( tweeners[ prop ] || [] ).concat( tweeners[ "*" ] ),
		index = 0,
		length = collection.length;
	for ( ; index < length; index++ ) {
		if ( (tween = collection[ index ].call( animation, prop, value )) ) {

			// we're done with this property
			return tween;
		}
	}
}

function defaultPrefilter( elem, props, opts ) {
	/* jshint validthis: true */
	var prop, value, toggle, tween, hooks, oldfire, display, checkDisplay,
		anim = this,
		orig = {},
		style = elem.style,
		hidden = elem.nodeType && isHidden( elem ),
		dataShow = data_priv.get( elem, "fxshow" );

	// handle queue: false promises
	if ( !opts.queue ) {
		hooks = jQuery._queueHooks( elem, "fx" );
		if ( hooks.unqueued == null ) {
			hooks.unqueued = 0;
			oldfire = hooks.empty.fire;
			hooks.empty.fire = function() {
				if ( !hooks.unqueued ) {
					oldfire();
				}
			};
		}
		hooks.unqueued++;

		anim.always(function() {
			// doing this makes sure that the complete handler will be called
			// before this completes
			anim.always(function() {
				hooks.unqueued--;
				if ( !jQuery.queue( elem, "fx" ).length ) {
					hooks.empty.fire();
				}
			});
		});
	}

	// height/width overflow pass
	if ( elem.nodeType === 1 && ( "height" in props || "width" in props ) ) {
		// Make sure that nothing sneaks out
		// Record all 3 overflow attributes because IE9-10 do not
		// change the overflow attribute when overflowX and
		// overflowY are set to the same value
		opts.overflow = [ style.overflow, style.overflowX, style.overflowY ];

		// Set display property to inline-block for height/width
		// animations on inline elements that are having width/height animated
		display = jQuery.css( elem, "display" );

		// Test default display if display is currently "none"
		checkDisplay = display === "none" ?
			data_priv.get( elem, "olddisplay" ) || defaultDisplay( elem.nodeName ) : display;

		if ( checkDisplay === "inline" && jQuery.css( elem, "float" ) === "none" ) {
			style.display = "inline-block";
		}
	}

	if ( opts.overflow ) {
		style.overflow = "hidden";
		anim.always(function() {
			style.overflow = opts.overflow[ 0 ];
			style.overflowX = opts.overflow[ 1 ];
			style.overflowY = opts.overflow[ 2 ];
		});
	}

	// show/hide pass
	for ( prop in props ) {
		value = props[ prop ];
		if ( rfxtypes.exec( value ) ) {
			delete props[ prop ];
			toggle = toggle || value === "toggle";
			if ( value === ( hidden ? "hide" : "show" ) ) {

				// If there is dataShow left over from a stopped hide or show and we are going to proceed with show, we should pretend to be hidden
				if ( value === "show" && dataShow && dataShow[ prop ] !== undefined ) {
					hidden = true;
				} else {
					continue;
				}
			}
			orig[ prop ] = dataShow && dataShow[ prop ] || jQuery.style( elem, prop );

		// Any non-fx value stops us from restoring the original display value
		} else {
			display = undefined;
		}
	}

	if ( !jQuery.isEmptyObject( orig ) ) {
		if ( dataShow ) {
			if ( "hidden" in dataShow ) {
				hidden = dataShow.hidden;
			}
		} else {
			dataShow = data_priv.access( elem, "fxshow", {} );
		}

		// store state if its toggle - enables .stop().toggle() to "reverse"
		if ( toggle ) {
			dataShow.hidden = !hidden;
		}
		if ( hidden ) {
			jQuery( elem ).show();
		} else {
			anim.done(function() {
				jQuery( elem ).hide();
			});
		}
		anim.done(function() {
			var prop;

			data_priv.remove( elem, "fxshow" );
			for ( prop in orig ) {
				jQuery.style( elem, prop, orig[ prop ] );
			}
		});
		for ( prop in orig ) {
			tween = createTween( hidden ? dataShow[ prop ] : 0, prop, anim );

			if ( !( prop in dataShow ) ) {
				dataShow[ prop ] = tween.start;
				if ( hidden ) {
					tween.end = tween.start;
					tween.start = prop === "width" || prop === "height" ? 1 : 0;
				}
			}
		}

	// If this is a noop like .hide().hide(), restore an overwritten display value
	} else if ( (display === "none" ? defaultDisplay( elem.nodeName ) : display) === "inline" ) {
		style.display = display;
	}
}

function propFilter( props, specialEasing ) {
	var index, name, easing, value, hooks;

	// camelCase, specialEasing and expand cssHook pass
	for ( index in props ) {
		name = jQuery.camelCase( index );
		easing = specialEasing[ name ];
		value = props[ index ];
		if ( jQuery.isArray( value ) ) {
			easing = value[ 1 ];
			value = props[ index ] = value[ 0 ];
		}

		if ( index !== name ) {
			props[ name ] = value;
			delete props[ index ];
		}

		hooks = jQuery.cssHooks[ name ];
		if ( hooks && "expand" in hooks ) {
			value = hooks.expand( value );
			delete props[ name ];

			// not quite $.extend, this wont overwrite keys already present.
			// also - reusing 'index' from above because we have the correct "name"
			for ( index in value ) {
				if ( !( index in props ) ) {
					props[ index ] = value[ index ];
					specialEasing[ index ] = easing;
				}
			}
		} else {
			specialEasing[ name ] = easing;
		}
	}
}

function Animation( elem, properties, options ) {
	var result,
		stopped,
		index = 0,
		length = animationPrefilters.length,
		deferred = jQuery.Deferred().always( function() {
			// don't match elem in the :animated selector
			delete tick.elem;
		}),
		tick = function() {
			if ( stopped ) {
				return false;
			}
			var currentTime = fxNow || createFxNow(),
				remaining = Math.max( 0, animation.startTime + animation.duration - currentTime ),
				// archaic crash bug won't allow us to use 1 - ( 0.5 || 0 ) (#12497)
				temp = remaining / animation.duration || 0,
				percent = 1 - temp,
				index = 0,
				length = animation.tweens.length;

			for ( ; index < length ; index++ ) {
				animation.tweens[ index ].run( percent );
			}

			deferred.notifyWith( elem, [ animation, percent, remaining ]);

			if ( percent < 1 && length ) {
				return remaining;
			} else {
				deferred.resolveWith( elem, [ animation ] );
				return false;
			}
		},
		animation = deferred.promise({
			elem: elem,
			props: jQuery.extend( {}, properties ),
			opts: jQuery.extend( true, { specialEasing: {} }, options ),
			originalProperties: properties,
			originalOptions: options,
			startTime: fxNow || createFxNow(),
			duration: options.duration,
			tweens: [],
			createTween: function( prop, end ) {
				var tween = jQuery.Tween( elem, animation.opts, prop, end,
						animation.opts.specialEasing[ prop ] || animation.opts.easing );
				animation.tweens.push( tween );
				return tween;
			},
			stop: function( gotoEnd ) {
				var index = 0,
					// if we are going to the end, we want to run all the tweens
					// otherwise we skip this part
					length = gotoEnd ? animation.tweens.length : 0;
				if ( stopped ) {
					return this;
				}
				stopped = true;
				for ( ; index < length ; index++ ) {
					animation.tweens[ index ].run( 1 );
				}

				// resolve when we played the last frame
				// otherwise, reject
				if ( gotoEnd ) {
					deferred.resolveWith( elem, [ animation, gotoEnd ] );
				} else {
					deferred.rejectWith( elem, [ animation, gotoEnd ] );
				}
				return this;
			}
		}),
		props = animation.props;

	propFilter( props, animation.opts.specialEasing );

	for ( ; index < length ; index++ ) {
		result = animationPrefilters[ index ].call( animation, elem, props, animation.opts );
		if ( result ) {
			return result;
		}
	}

	jQuery.map( props, createTween, animation );

	if ( jQuery.isFunction( animation.opts.start ) ) {
		animation.opts.start.call( elem, animation );
	}

	jQuery.fx.timer(
		jQuery.extend( tick, {
			elem: elem,
			anim: animation,
			queue: animation.opts.queue
		})
	);

	// attach callbacks from options
	return animation.progress( animation.opts.progress )
		.done( animation.opts.done, animation.opts.complete )
		.fail( animation.opts.fail )
		.always( animation.opts.always );
}

jQuery.Animation = jQuery.extend( Animation, {

	tweener: function( props, callback ) {
		if ( jQuery.isFunction( props ) ) {
			callback = props;
			props = [ "*" ];
		} else {
			props = props.split(" ");
		}

		var prop,
			index = 0,
			length = props.length;

		for ( ; index < length ; index++ ) {
			prop = props[ index ];
			tweeners[ prop ] = tweeners[ prop ] || [];
			tweeners[ prop ].unshift( callback );
		}
	},

	prefilter: function( callback, prepend ) {
		if ( prepend ) {
			animationPrefilters.unshift( callback );
		} else {
			animationPrefilters.push( callback );
		}
	}
});

jQuery.speed = function( speed, easing, fn ) {
	var opt = speed && typeof speed === "object" ? jQuery.extend( {}, speed ) : {
		complete: fn || !fn && easing ||
			jQuery.isFunction( speed ) && speed,
		duration: speed,
		easing: fn && easing || easing && !jQuery.isFunction( easing ) && easing
	};

	opt.duration = jQuery.fx.off ? 0 : typeof opt.duration === "number" ? opt.duration :
		opt.duration in jQuery.fx.speeds ? jQuery.fx.speeds[ opt.duration ] : jQuery.fx.speeds._default;

	// normalize opt.queue - true/undefined/null -> "fx"
	if ( opt.queue == null || opt.queue === true ) {
		opt.queue = "fx";
	}

	// Queueing
	opt.old = opt.complete;

	opt.complete = function() {
		if ( jQuery.isFunction( opt.old ) ) {
			opt.old.call( this );
		}

		if ( opt.queue ) {
			jQuery.dequeue( this, opt.queue );
		}
	};

	return opt;
};

jQuery.fn.extend({
	fadeTo: function( speed, to, easing, callback ) {

		// show any hidden elements after setting opacity to 0
		return this.filter( isHidden ).css( "opacity", 0 ).show()

			// animate to the value specified
			.end().animate({ opacity: to }, speed, easing, callback );
	},
	animate: function( prop, speed, easing, callback ) {
		var empty = jQuery.isEmptyObject( prop ),
			optall = jQuery.speed( speed, easing, callback ),
			doAnimation = function() {
				// Operate on a copy of prop so per-property easing won't be lost
				var anim = Animation( this, jQuery.extend( {}, prop ), optall );

				// Empty animations, or finishing resolves immediately
				if ( empty || data_priv.get( this, "finish" ) ) {
					anim.stop( true );
				}
			};
			doAnimation.finish = doAnimation;

		return empty || optall.queue === false ?
			this.each( doAnimation ) :
			this.queue( optall.queue, doAnimation );
	},
	stop: function( type, clearQueue, gotoEnd ) {
		var stopQueue = function( hooks ) {
			var stop = hooks.stop;
			delete hooks.stop;
			stop( gotoEnd );
		};

		if ( typeof type !== "string" ) {
			gotoEnd = clearQueue;
			clearQueue = type;
			type = undefined;
		}
		if ( clearQueue && type !== false ) {
			this.queue( type || "fx", [] );
		}

		return this.each(function() {
			var dequeue = true,
				index = type != null && type + "queueHooks",
				timers = jQuery.timers,
				data = data_priv.get( this );

			if ( index ) {
				if ( data[ index ] && data[ index ].stop ) {
					stopQueue( data[ index ] );
				}
			} else {
				for ( index in data ) {
					if ( data[ index ] && data[ index ].stop && rrun.test( index ) ) {
						stopQueue( data[ index ] );
					}
				}
			}

			for ( index = timers.length; index--; ) {
				if ( timers[ index ].elem === this && (type == null || timers[ index ].queue === type) ) {
					timers[ index ].anim.stop( gotoEnd );
					dequeue = false;
					timers.splice( index, 1 );
				}
			}

			// start the next in the queue if the last step wasn't forced
			// timers currently will call their complete callbacks, which will dequeue
			// but only if they were gotoEnd
			if ( dequeue || !gotoEnd ) {
				jQuery.dequeue( this, type );
			}
		});
	},
	finish: function( type ) {
		if ( type !== false ) {
			type = type || "fx";
		}
		return this.each(function() {
			var index,
				data = data_priv.get( this ),
				queue = data[ type + "queue" ],
				hooks = data[ type + "queueHooks" ],
				timers = jQuery.timers,
				length = queue ? queue.length : 0;

			// enable finishing flag on private data
			data.finish = true;

			// empty the queue first
			jQuery.queue( this, type, [] );

			if ( hooks && hooks.stop ) {
				hooks.stop.call( this, true );
			}

			// look for any active animations, and finish them
			for ( index = timers.length; index--; ) {
				if ( timers[ index ].elem === this && timers[ index ].queue === type ) {
					timers[ index ].anim.stop( true );
					timers.splice( index, 1 );
				}
			}

			// look for any animations in the old queue and finish them
			for ( index = 0; index < length; index++ ) {
				if ( queue[ index ] && queue[ index ].finish ) {
					queue[ index ].finish.call( this );
				}
			}

			// turn off finishing flag
			delete data.finish;
		});
	}
});

jQuery.each([ "toggle", "show", "hide" ], function( i, name ) {
	var cssFn = jQuery.fn[ name ];
	jQuery.fn[ name ] = function( speed, easing, callback ) {
		return speed == null || typeof speed === "boolean" ?
			cssFn.apply( this, arguments ) :
			this.animate( genFx( name, true ), speed, easing, callback );
	};
});

// Generate shortcuts for custom animations
jQuery.each({
	slideDown: genFx("show"),
	slideUp: genFx("hide"),
	slideToggle: genFx("toggle"),
	fadeIn: { opacity: "show" },
	fadeOut: { opacity: "hide" },
	fadeToggle: { opacity: "toggle" }
}, function( name, props ) {
	jQuery.fn[ name ] = function( speed, easing, callback ) {
		return this.animate( props, speed, easing, callback );
	};
});

jQuery.timers = [];
jQuery.fx.tick = function() {
	var timer,
		i = 0,
		timers = jQuery.timers;

	fxNow = jQuery.now();

	for ( ; i < timers.length; i++ ) {
		timer = timers[ i ];
		// Checks the timer has not already been removed
		if ( !timer() && timers[ i ] === timer ) {
			timers.splice( i--, 1 );
		}
	}

	if ( !timers.length ) {
		jQuery.fx.stop();
	}
	fxNow = undefined;
};

jQuery.fx.timer = function( timer ) {
	jQuery.timers.push( timer );
	if ( timer() ) {
		jQuery.fx.start();
	} else {
		jQuery.timers.pop();
	}
};

jQuery.fx.interval = 13;

jQuery.fx.start = function() {
	if ( !timerId ) {
		timerId = setInterval( jQuery.fx.tick, jQuery.fx.interval );
	}
};

jQuery.fx.stop = function() {
	clearInterval( timerId );
	timerId = null;
};

jQuery.fx.speeds = {
	slow: 600,
	fast: 200,
	// Default speed
	_default: 400
};


// Based off of the plugin by Clint Helfers, with permission.
// http://blindsignals.com/index.php/2009/07/jquery-delay/
jQuery.fn.delay = function( time, type ) {
	time = jQuery.fx ? jQuery.fx.speeds[ time ] || time : time;
	type = type || "fx";

	return this.queue( type, function( next, hooks ) {
		var timeout = setTimeout( next, time );
		hooks.stop = function() {
			clearTimeout( timeout );
		};
	});
};


(function() {
	var input = document.createElement( "input" ),
		select = document.createElement( "select" ),
		opt = select.appendChild( document.createElement( "option" ) );

	input.type = "checkbox";

	// Support: iOS 5.1, Android 4.x, Android 2.3
	// Check the default checkbox/radio value ("" on old WebKit; "on" elsewhere)
	support.checkOn = input.value !== "";

	// Must access the parent to make an option select properly
	// Support: IE9, IE10
	support.optSelected = opt.selected;

	// Make sure that the options inside disabled selects aren't marked as disabled
	// (WebKit marks them as disabled)
	select.disabled = true;
	support.optDisabled = !opt.disabled;

	// Check if an input maintains its value after becoming a radio
	// Support: IE9, IE10
	input = document.createElement( "input" );
	input.value = "t";
	input.type = "radio";
	support.radioValue = input.value === "t";
})();


var nodeHook, boolHook,
	attrHandle = jQuery.expr.attrHandle;

jQuery.fn.extend({
	attr: function( name, value ) {
		return access( this, jQuery.attr, name, value, arguments.length > 1 );
	},

	removeAttr: function( name ) {
		return this.each(function() {
			jQuery.removeAttr( this, name );
		});
	}
});

jQuery.extend({
	attr: function( elem, name, value ) {
		var hooks, ret,
			nType = elem.nodeType;

		// don't get/set attributes on text, comment and attribute nodes
		if ( !elem || nType === 3 || nType === 8 || nType === 2 ) {
			return;
		}

		// Fallback to prop when attributes are not supported
		if ( typeof elem.getAttribute === strundefined ) {
			return jQuery.prop( elem, name, value );
		}

		// All attributes are lowercase
		// Grab necessary hook if one is defined
		if ( nType !== 1 || !jQuery.isXMLDoc( elem ) ) {
			name = name.toLowerCase();
			hooks = jQuery.attrHooks[ name ] ||
				( jQuery.expr.match.bool.test( name ) ? boolHook : nodeHook );
		}

		if ( value !== undefined ) {

			if ( value === null ) {
				jQuery.removeAttr( elem, name );

			} else if ( hooks && "set" in hooks && (ret = hooks.set( elem, value, name )) !== undefined ) {
				return ret;

			} else {
				elem.setAttribute( name, value + "" );
				return value;
			}

		} else if ( hooks && "get" in hooks && (ret = hooks.get( elem, name )) !== null ) {
			return ret;

		} else {
			ret = jQuery.find.attr( elem, name );

			// Non-existent attributes return null, we normalize to undefined
			return ret == null ?
				undefined :
				ret;
		}
	},

	removeAttr: function( elem, value ) {
		var name, propName,
			i = 0,
			attrNames = value && value.match( rnotwhite );

		if ( attrNames && elem.nodeType === 1 ) {
			while ( (name = attrNames[i++]) ) {
				propName = jQuery.propFix[ name ] || name;

				// Boolean attributes get special treatment (#10870)
				if ( jQuery.expr.match.bool.test( name ) ) {
					// Set corresponding property to false
					elem[ propName ] = false;
				}

				elem.removeAttribute( name );
			}
		}
	},

	attrHooks: {
		type: {
			set: function( elem, value ) {
				if ( !support.radioValue && value === "radio" &&
					jQuery.nodeName( elem, "input" ) ) {
					// Setting the type on a radio button after the value resets the value in IE6-9
					// Reset value to default in case type is set after value during creation
					var val = elem.value;
					elem.setAttribute( "type", value );
					if ( val ) {
						elem.value = val;
					}
					return value;
				}
			}
		}
	}
});

// Hooks for boolean attributes
boolHook = {
	set: function( elem, value, name ) {
		if ( value === false ) {
			// Remove boolean attributes when set to false
			jQuery.removeAttr( elem, name );
		} else {
			elem.setAttribute( name, name );
		}
		return name;
	}
};
jQuery.each( jQuery.expr.match.bool.source.match( /\w+/g ), function( i, name ) {
	var getter = attrHandle[ name ] || jQuery.find.attr;

	attrHandle[ name ] = function( elem, name, isXML ) {
		var ret, handle;
		if ( !isXML ) {
			// Avoid an infinite loop by temporarily removing this function from the getter
			handle = attrHandle[ name ];
			attrHandle[ name ] = ret;
			ret = getter( elem, name, isXML ) != null ?
				name.toLowerCase() :
				null;
			attrHandle[ name ] = handle;
		}
		return ret;
	};
});




var rfocusable = /^(?:input|select|textarea|button)$/i;

jQuery.fn.extend({
	prop: function( name, value ) {
		return access( this, jQuery.prop, name, value, arguments.length > 1 );
	},

	removeProp: function( name ) {
		return this.each(function() {
			delete this[ jQuery.propFix[ name ] || name ];
		});
	}
});

jQuery.extend({
	propFix: {
		"for": "htmlFor",
		"class": "className"
	},

	prop: function( elem, name, value ) {
		var ret, hooks, notxml,
			nType = elem.nodeType;

		// don't get/set properties on text, comment and attribute nodes
		if ( !elem || nType === 3 || nType === 8 || nType === 2 ) {
			return;
		}

		notxml = nType !== 1 || !jQuery.isXMLDoc( elem );

		if ( notxml ) {
			// Fix name and attach hooks
			name = jQuery.propFix[ name ] || name;
			hooks = jQuery.propHooks[ name ];
		}

		if ( value !== undefined ) {
			return hooks && "set" in hooks && (ret = hooks.set( elem, value, name )) !== undefined ?
				ret :
				( elem[ name ] = value );

		} else {
			return hooks && "get" in hooks && (ret = hooks.get( elem, name )) !== null ?
				ret :
				elem[ name ];
		}
	},

	propHooks: {
		tabIndex: {
			get: function( elem ) {
				return elem.hasAttribute( "tabindex" ) || rfocusable.test( elem.nodeName ) || elem.href ?
					elem.tabIndex :
					-1;
			}
		}
	}
});

// Support: IE9+
// Selectedness for an option in an optgroup can be inaccurate
if ( !support.optSelected ) {
	jQuery.propHooks.selected = {
		get: function( elem ) {
			var parent = elem.parentNode;
			if ( parent && parent.parentNode ) {
				parent.parentNode.selectedIndex;
			}
			return null;
		}
	};
}

jQuery.each([
	"tabIndex",
	"readOnly",
	"maxLength",
	"cellSpacing",
	"cellPadding",
	"rowSpan",
	"colSpan",
	"useMap",
	"frameBorder",
	"contentEditable"
], function() {
	jQuery.propFix[ this.toLowerCase() ] = this;
});




var rclass = /[\t\r\n\f]/g;

jQuery.fn.extend({
	addClass: function( value ) {
		var classes, elem, cur, clazz, j, finalValue,
			proceed = typeof value === "string" && value,
			i = 0,
			len = this.length;

		if ( jQuery.isFunction( value ) ) {
			return this.each(function( j ) {
				jQuery( this ).addClass( value.call( this, j, this.className ) );
			});
		}

		if ( proceed ) {
			// The disjunction here is for better compressibility (see removeClass)
			classes = ( value || "" ).match( rnotwhite ) || [];

			for ( ; i < len; i++ ) {
				elem = this[ i ];
				cur = elem.nodeType === 1 && ( elem.className ?
					( " " + elem.className + " " ).replace( rclass, " " ) :
					" "
				);

				if ( cur ) {
					j = 0;
					while ( (clazz = classes[j++]) ) {
						if ( cur.indexOf( " " + clazz + " " ) < 0 ) {
							cur += clazz + " ";
						}
					}

					// only assign if different to avoid unneeded rendering.
					finalValue = jQuery.trim( cur );
					if ( elem.className !== finalValue ) {
						elem.className = finalValue;
					}
				}
			}
		}

		return this;
	},

	removeClass: function( value ) {
		var classes, elem, cur, clazz, j, finalValue,
			proceed = arguments.length === 0 || typeof value === "string" && value,
			i = 0,
			len = this.length;

		if ( jQuery.isFunction( value ) ) {
			return this.each(function( j ) {
				jQuery( this ).removeClass( value.call( this, j, this.className ) );
			});
		}
		if ( proceed ) {
			classes = ( value || "" ).match( rnotwhite ) || [];

			for ( ; i < len; i++ ) {
				elem = this[ i ];
				// This expression is here for better compressibility (see addClass)
				cur = elem.nodeType === 1 && ( elem.className ?
					( " " + elem.className + " " ).replace( rclass, " " ) :
					""
				);

				if ( cur ) {
					j = 0;
					while ( (clazz = classes[j++]) ) {
						// Remove *all* instances
						while ( cur.indexOf( " " + clazz + " " ) >= 0 ) {
							cur = cur.replace( " " + clazz + " ", " " );
						}
					}

					// only assign if different to avoid unneeded rendering.
					finalValue = value ? jQuery.trim( cur ) : "";
					if ( elem.className !== finalValue ) {
						elem.className = finalValue;
					}
				}
			}
		}

		return this;
	},

	toggleClass: function( value, stateVal ) {
		var type = typeof value;

		if ( typeof stateVal === "boolean" && type === "string" ) {
			return stateVal ? this.addClass( value ) : this.removeClass( value );
		}

		if ( jQuery.isFunction( value ) ) {
			return this.each(function( i ) {
				jQuery( this ).toggleClass( value.call(this, i, this.className, stateVal), stateVal );
			});
		}

		return this.each(function() {
			if ( type === "string" ) {
				// toggle individual class names
				var className,
					i = 0,
					self = jQuery( this ),
					classNames = value.match( rnotwhite ) || [];

				while ( (className = classNames[ i++ ]) ) {
					// check each className given, space separated list
					if ( self.hasClass( className ) ) {
						self.removeClass( className );
					} else {
						self.addClass( className );
					}
				}

			// Toggle whole class name
			} else if ( type === strundefined || type === "boolean" ) {
				if ( this.className ) {
					// store className if set
					data_priv.set( this, "__className__", this.className );
				}

				// If the element has a class name or if we're passed "false",
				// then remove the whole classname (if there was one, the above saved it).
				// Otherwise bring back whatever was previously saved (if anything),
				// falling back to the empty string if nothing was stored.
				this.className = this.className || value === false ? "" : data_priv.get( this, "__className__" ) || "";
			}
		});
	},

	hasClass: function( selector ) {
		var className = " " + selector + " ",
			i = 0,
			l = this.length;
		for ( ; i < l; i++ ) {
			if ( this[i].nodeType === 1 && (" " + this[i].className + " ").replace(rclass, " ").indexOf( className ) >= 0 ) {
				return true;
			}
		}

		return false;
	}
});




var rreturn = /\r/g;

jQuery.fn.extend({
	val: function( value ) {
		var hooks, ret, isFunction,
			elem = this[0];

		if ( !arguments.length ) {
			if ( elem ) {
				hooks = jQuery.valHooks[ elem.type ] || jQuery.valHooks[ elem.nodeName.toLowerCase() ];

				if ( hooks && "get" in hooks && (ret = hooks.get( elem, "value" )) !== undefined ) {
					return ret;
				}

				ret = elem.value;

				return typeof ret === "string" ?
					// handle most common string cases
					ret.replace(rreturn, "") :
					// handle cases where value is null/undef or number
					ret == null ? "" : ret;
			}

			return;
		}

		isFunction = jQuery.isFunction( value );

		return this.each(function( i ) {
			var val;

			if ( this.nodeType !== 1 ) {
				return;
			}

			if ( isFunction ) {
				val = value.call( this, i, jQuery( this ).val() );
			} else {
				val = value;
			}

			// Treat null/undefined as ""; convert numbers to string
			if ( val == null ) {
				val = "";

			} else if ( typeof val === "number" ) {
				val += "";

			} else if ( jQuery.isArray( val ) ) {
				val = jQuery.map( val, function( value ) {
					return value == null ? "" : value + "";
				});
			}

			hooks = jQuery.valHooks[ this.type ] || jQuery.valHooks[ this.nodeName.toLowerCase() ];

			// If set returns undefined, fall back to normal setting
			if ( !hooks || !("set" in hooks) || hooks.set( this, val, "value" ) === undefined ) {
				this.value = val;
			}
		});
	}
});

jQuery.extend({
	valHooks: {
		option: {
			get: function( elem ) {
				var val = jQuery.find.attr( elem, "value" );
				return val != null ?
					val :
					// Support: IE10-11+
					// option.text throws exceptions (#14686, #14858)
					jQuery.trim( jQuery.text( elem ) );
			}
		},
		select: {
			get: function( elem ) {
				var value, option,
					options = elem.options,
					index = elem.selectedIndex,
					one = elem.type === "select-one" || index < 0,
					values = one ? null : [],
					max = one ? index + 1 : options.length,
					i = index < 0 ?
						max :
						one ? index : 0;

				// Loop through all the selected options
				for ( ; i < max; i++ ) {
					option = options[ i ];

					// IE6-9 doesn't update selected after form reset (#2551)
					if ( ( option.selected || i === index ) &&
							// Don't return options that are disabled or in a disabled optgroup
							( support.optDisabled ? !option.disabled : option.getAttribute( "disabled" ) === null ) &&
							( !option.parentNode.disabled || !jQuery.nodeName( option.parentNode, "optgroup" ) ) ) {

						// Get the specific value for the option
						value = jQuery( option ).val();

						// We don't need an array for one selects
						if ( one ) {
							return value;
						}

						// Multi-Selects return an array
						values.push( value );
					}
				}

				return values;
			},

			set: function( elem, value ) {
				var optionSet, option,
					options = elem.options,
					values = jQuery.makeArray( value ),
					i = options.length;

				while ( i-- ) {
					option = options[ i ];
					if ( (option.selected = jQuery.inArray( option.value, values ) >= 0) ) {
						optionSet = true;
					}
				}

				// force browsers to behave consistently when non-matching value is set
				if ( !optionSet ) {
					elem.selectedIndex = -1;
				}
				return values;
			}
		}
	}
});

// Radios and checkboxes getter/setter
jQuery.each([ "radio", "checkbox" ], function() {
	jQuery.valHooks[ this ] = {
		set: function( elem, value ) {
			if ( jQuery.isArray( value ) ) {
				return ( elem.checked = jQuery.inArray( jQuery(elem).val(), value ) >= 0 );
			}
		}
	};
	if ( !support.checkOn ) {
		jQuery.valHooks[ this ].get = function( elem ) {
			// Support: Webkit
			// "" is returned instead of "on" if a value isn't specified
			return elem.getAttribute("value") === null ? "on" : elem.value;
		};
	}
});




// Return jQuery for attributes-only inclusion


jQuery.each( ("blur focus focusin focusout load resize scroll unload click dblclick " +
	"mousedown mouseup mousemove mouseover mouseout mouseenter mouseleave " +
	"change select submit keydown keypress keyup error contextmenu").split(" "), function( i, name ) {

	// Handle event binding
	jQuery.fn[ name ] = function( data, fn ) {
		return arguments.length > 0 ?
			this.on( name, null, data, fn ) :
			this.trigger( name );
	};
});

jQuery.fn.extend({
	hover: function( fnOver, fnOut ) {
		return this.mouseenter( fnOver ).mouseleave( fnOut || fnOver );
	},

	bind: function( types, data, fn ) {
		return this.on( types, null, data, fn );
	},
	unbind: function( types, fn ) {
		return this.off( types, null, fn );
	},

	delegate: function( selector, types, data, fn ) {
		return this.on( types, selector, data, fn );
	},
	undelegate: function( selector, types, fn ) {
		// ( namespace ) or ( selector, types [, fn] )
		return arguments.length === 1 ? this.off( selector, "**" ) : this.off( types, selector || "**", fn );
	}
});


var nonce = jQuery.now();

var rquery = (/\?/);



// Support: Android 2.3
// Workaround failure to string-cast null input
jQuery.parseJSON = function( data ) {
	return JSON.parse( data + "" );
};


// Cross-browser xml parsing
jQuery.parseXML = function( data ) {
	var xml, tmp;
	if ( !data || typeof data !== "string" ) {
		return null;
	}

	// Support: IE9
	try {
		tmp = new DOMParser();
		xml = tmp.parseFromString( data, "text/xml" );
	} catch ( e ) {
		xml = undefined;
	}

	if ( !xml || xml.getElementsByTagName( "parsererror" ).length ) {
		jQuery.error( "Invalid XML: " + data );
	}
	return xml;
};


var
	// Document location
	ajaxLocParts,
	ajaxLocation,

	rhash = /#.*$/,
	rts = /([?&])_=[^&]*/,
	rheaders = /^(.*?):[ \t]*([^\r\n]*)$/mg,
	// #7653, #8125, #8152: local protocol detection
	rlocalProtocol = /^(?:about|app|app-storage|.+-extension|file|res|widget):$/,
	rnoContent = /^(?:GET|HEAD)$/,
	rprotocol = /^\/\//,
	rurl = /^([\w.+-]+:)(?:\/\/(?:[^\/?#]*@|)([^\/?#:]*)(?::(\d+)|)|)/,

	/* Prefilters
	 * 1) They are useful to introduce custom dataTypes (see ajax/jsonp.js for an example)
	 * 2) These are called:
	 *    - BEFORE asking for a transport
	 *    - AFTER param serialization (s.data is a string if s.processData is true)
	 * 3) key is the dataType
	 * 4) the catchall symbol "*" can be used
	 * 5) execution will start with transport dataType and THEN continue down to "*" if needed
	 */
	prefilters = {},

	/* Transports bindings
	 * 1) key is the dataType
	 * 2) the catchall symbol "*" can be used
	 * 3) selection will start with transport dataType and THEN go to "*" if needed
	 */
	transports = {},

	// Avoid comment-prolog char sequence (#10098); must appease lint and evade compression
	allTypes = "*/".concat("*");

// #8138, IE may throw an exception when accessing
// a field from window.location if document.domain has been set
try {
	ajaxLocation = location.href;
} catch( e ) {
	// Use the href attribute of an A element
	// since IE will modify it given document.location
	ajaxLocation = document.createElement( "a" );
	ajaxLocation.href = "";
	ajaxLocation = ajaxLocation.href;
}

// Segment location into parts
ajaxLocParts = rurl.exec( ajaxLocation.toLowerCase() ) || [];

// Base "constructor" for jQuery.ajaxPrefilter and jQuery.ajaxTransport
function addToPrefiltersOrTransports( structure ) {

	// dataTypeExpression is optional and defaults to "*"
	return function( dataTypeExpression, func ) {

		if ( typeof dataTypeExpression !== "string" ) {
			func = dataTypeExpression;
			dataTypeExpression = "*";
		}

		var dataType,
			i = 0,
			dataTypes = dataTypeExpression.toLowerCase().match( rnotwhite ) || [];

		if ( jQuery.isFunction( func ) ) {
			// For each dataType in the dataTypeExpression
			while ( (dataType = dataTypes[i++]) ) {
				// Prepend if requested
				if ( dataType[0] === "+" ) {
					dataType = dataType.slice( 1 ) || "*";
					(structure[ dataType ] = structure[ dataType ] || []).unshift( func );

				// Otherwise append
				} else {
					(structure[ dataType ] = structure[ dataType ] || []).push( func );
				}
			}
		}
	};
}

// Base inspection function for prefilters and transports
function inspectPrefiltersOrTransports( structure, options, originalOptions, jqXHR ) {

	var inspected = {},
		seekingTransport = ( structure === transports );

	function inspect( dataType ) {
		var selected;
		inspected[ dataType ] = true;
		jQuery.each( structure[ dataType ] || [], function( _, prefilterOrFactory ) {
			var dataTypeOrTransport = prefilterOrFactory( options, originalOptions, jqXHR );
			if ( typeof dataTypeOrTransport === "string" && !seekingTransport && !inspected[ dataTypeOrTransport ] ) {
				options.dataTypes.unshift( dataTypeOrTransport );
				inspect( dataTypeOrTransport );
				return false;
			} else if ( seekingTransport ) {
				return !( selected = dataTypeOrTransport );
			}
		});
		return selected;
	}

	return inspect( options.dataTypes[ 0 ] ) || !inspected[ "*" ] && inspect( "*" );
}

// A special extend for ajax options
// that takes "flat" options (not to be deep extended)
// Fixes #9887
function ajaxExtend( target, src ) {
	var key, deep,
		flatOptions = jQuery.ajaxSettings.flatOptions || {};

	for ( key in src ) {
		if ( src[ key ] !== undefined ) {
			( flatOptions[ key ] ? target : ( deep || (deep = {}) ) )[ key ] = src[ key ];
		}
	}
	if ( deep ) {
		jQuery.extend( true, target, deep );
	}

	return target;
}

/* Handles responses to an ajax request:
 * - finds the right dataType (mediates between content-type and expected dataType)
 * - returns the corresponding response
 */
function ajaxHandleResponses( s, jqXHR, responses ) {

	var ct, type, finalDataType, firstDataType,
		contents = s.contents,
		dataTypes = s.dataTypes;

	// Remove auto dataType and get content-type in the process
	while ( dataTypes[ 0 ] === "*" ) {
		dataTypes.shift();
		if ( ct === undefined ) {
			ct = s.mimeType || jqXHR.getResponseHeader("Content-Type");
		}
	}

	// Check if we're dealing with a known content-type
	if ( ct ) {
		for ( type in contents ) {
			if ( contents[ type ] && contents[ type ].test( ct ) ) {
				dataTypes.unshift( type );
				break;
			}
		}
	}

	// Check to see if we have a response for the expected dataType
	if ( dataTypes[ 0 ] in responses ) {
		finalDataType = dataTypes[ 0 ];
	} else {
		// Try convertible dataTypes
		for ( type in responses ) {
			if ( !dataTypes[ 0 ] || s.converters[ type + " " + dataTypes[0] ] ) {
				finalDataType = type;
				break;
			}
			if ( !firstDataType ) {
				firstDataType = type;
			}
		}
		// Or just use first one
		finalDataType = finalDataType || firstDataType;
	}

	// If we found a dataType
	// We add the dataType to the list if needed
	// and return the corresponding response
	if ( finalDataType ) {
		if ( finalDataType !== dataTypes[ 0 ] ) {
			dataTypes.unshift( finalDataType );
		}
		return responses[ finalDataType ];
	}
}

/* Chain conversions given the request and the original response
 * Also sets the responseXXX fields on the jqXHR instance
 */
function ajaxConvert( s, response, jqXHR, isSuccess ) {
	var conv2, current, conv, tmp, prev,
		converters = {},
		// Work with a copy of dataTypes in case we need to modify it for conversion
		dataTypes = s.dataTypes.slice();

	// Create converters map with lowercased keys
	if ( dataTypes[ 1 ] ) {
		for ( conv in s.converters ) {
			converters[ conv.toLowerCase() ] = s.converters[ conv ];
		}
	}

	current = dataTypes.shift();

	// Convert to each sequential dataType
	while ( current ) {

		if ( s.responseFields[ current ] ) {
			jqXHR[ s.responseFields[ current ] ] = response;
		}

		// Apply the dataFilter if provided
		if ( !prev && isSuccess && s.dataFilter ) {
			response = s.dataFilter( response, s.dataType );
		}

		prev = current;
		current = dataTypes.shift();

		if ( current ) {

		// There's only work to do if current dataType is non-auto
			if ( current === "*" ) {

				current = prev;

			// Convert response if prev dataType is non-auto and differs from current
			} else if ( prev !== "*" && prev !== current ) {

				// Seek a direct converter
				conv = converters[ prev + " " + current ] || converters[ "* " + current ];

				// If none found, seek a pair
				if ( !conv ) {
					for ( conv2 in converters ) {

						// If conv2 outputs current
						tmp = conv2.split( " " );
						if ( tmp[ 1 ] === current ) {

							// If prev can be converted to accepted input
							conv = converters[ prev + " " + tmp[ 0 ] ] ||
								converters[ "* " + tmp[ 0 ] ];
							if ( conv ) {
								// Condense equivalence converters
								if ( conv === true ) {
									conv = converters[ conv2 ];

								// Otherwise, insert the intermediate dataType
								} else if ( converters[ conv2 ] !== true ) {
									current = tmp[ 0 ];
									dataTypes.unshift( tmp[ 1 ] );
								}
								break;
							}
						}
					}
				}

				// Apply converter (if not an equivalence)
				if ( conv !== true ) {

					// Unless errors are allowed to bubble, catch and return them
					if ( conv && s[ "throws" ] ) {
						response = conv( response );
					} else {
						try {
							response = conv( response );
						} catch ( e ) {
							return { state: "parsererror", error: conv ? e : "No conversion from " + prev + " to " + current };
						}
					}
				}
			}
		}
	}

	return { state: "success", data: response };
}

jQuery.extend({

	// Counter for holding the number of active queries
	active: 0,

	// Last-Modified header cache for next request
	lastModified: {},
	etag: {},

	ajaxSettings: {
		url: ajaxLocation,
		type: "GET",
		isLocal: rlocalProtocol.test( ajaxLocParts[ 1 ] ),
		global: true,
		processData: true,
		async: true,
		contentType: "application/x-www-form-urlencoded; charset=UTF-8",
		/*
		timeout: 0,
		data: null,
		dataType: null,
		username: null,
		password: null,
		cache: null,
		throws: false,
		traditional: false,
		headers: {},
		*/

		accepts: {
			"*": allTypes,
			text: "text/plain",
			html: "text/html",
			xml: "application/xml, text/xml",
			json: "application/json, text/javascript"
		},

		contents: {
			xml: /xml/,
			html: /html/,
			json: /json/
		},

		responseFields: {
			xml: "responseXML",
			text: "responseText",
			json: "responseJSON"
		},

		// Data converters
		// Keys separate source (or catchall "*") and destination types with a single space
		converters: {

			// Convert anything to text
			"* text": String,

			// Text to html (true = no transformation)
			"text html": true,

			// Evaluate text as a json expression
			"text json": jQuery.parseJSON,

			// Parse text as xml
			"text xml": jQuery.parseXML
		},

		// For options that shouldn't be deep extended:
		// you can add your own custom options here if
		// and when you create one that shouldn't be
		// deep extended (see ajaxExtend)
		flatOptions: {
			url: true,
			context: true
		}
	},

	// Creates a full fledged settings object into target
	// with both ajaxSettings and settings fields.
	// If target is omitted, writes into ajaxSettings.
	ajaxSetup: function( target, settings ) {
		return settings ?

			// Building a settings object
			ajaxExtend( ajaxExtend( target, jQuery.ajaxSettings ), settings ) :

			// Extending ajaxSettings
			ajaxExtend( jQuery.ajaxSettings, target );
	},

	ajaxPrefilter: addToPrefiltersOrTransports( prefilters ),
	ajaxTransport: addToPrefiltersOrTransports( transports ),

	// Main method
	ajax: function( url, options ) {

		// If url is an object, simulate pre-1.5 signature
		if ( typeof url === "object" ) {
			options = url;
			url = undefined;
		}

		// Force options to be an object
		options = options || {};

		var transport,
			// URL without anti-cache param
			cacheURL,
			// Response headers
			responseHeadersString,
			responseHeaders,
			// timeout handle
			timeoutTimer,
			// Cross-domain detection vars
			parts,
			// To know if global events are to be dispatched
			fireGlobals,
			// Loop variable
			i,
			// Create the final options object
			s = jQuery.ajaxSetup( {}, options ),
			// Callbacks context
			callbackContext = s.context || s,
			// Context for global events is callbackContext if it is a DOM node or jQuery collection
			globalEventContext = s.context && ( callbackContext.nodeType || callbackContext.jquery ) ?
				jQuery( callbackContext ) :
				jQuery.event,
			// Deferreds
			deferred = jQuery.Deferred(),
			completeDeferred = jQuery.Callbacks("once memory"),
			// Status-dependent callbacks
			statusCode = s.statusCode || {},
			// Headers (they are sent all at once)
			requestHeaders = {},
			requestHeadersNames = {},
			// The jqXHR state
			state = 0,
			// Default abort message
			strAbort = "canceled",
			// Fake xhr
			jqXHR = {
				readyState: 0,

				// Builds headers hashtable if needed
				getResponseHeader: function( key ) {
					var match;
					if ( state === 2 ) {
						if ( !responseHeaders ) {
							responseHeaders = {};
							while ( (match = rheaders.exec( responseHeadersString )) ) {
								responseHeaders[ match[1].toLowerCase() ] = match[ 2 ];
							}
						}
						match = responseHeaders[ key.toLowerCase() ];
					}
					return match == null ? null : match;
				},

				// Raw string
				getAllResponseHeaders: function() {
					return state === 2 ? responseHeadersString : null;
				},

				// Caches the header
				setRequestHeader: function( name, value ) {
					var lname = name.toLowerCase();
					if ( !state ) {
						name = requestHeadersNames[ lname ] = requestHeadersNames[ lname ] || name;
						requestHeaders[ name ] = value;
					}
					return this;
				},

				// Overrides response content-type header
				overrideMimeType: function( type ) {
					if ( !state ) {
						s.mimeType = type;
					}
					return this;
				},

				// Status-dependent callbacks
				statusCode: function( map ) {
					var code;
					if ( map ) {
						if ( state < 2 ) {
							for ( code in map ) {
								// Lazy-add the new callback in a way that preserves old ones
								statusCode[ code ] = [ statusCode[ code ], map[ code ] ];
							}
						} else {
							// Execute the appropriate callbacks
							jqXHR.always( map[ jqXHR.status ] );
						}
					}
					return this;
				},

				// Cancel the request
				abort: function( statusText ) {
					var finalText = statusText || strAbort;
					if ( transport ) {
						transport.abort( finalText );
					}
					done( 0, finalText );
					return this;
				}
			};

		// Attach deferreds
		deferred.promise( jqXHR ).complete = completeDeferred.add;
		jqXHR.success = jqXHR.done;
		jqXHR.error = jqXHR.fail;

		// Remove hash character (#7531: and string promotion)
		// Add protocol if not provided (prefilters might expect it)
		// Handle falsy url in the settings object (#10093: consistency with old signature)
		// We also use the url parameter if available
		s.url = ( ( url || s.url || ajaxLocation ) + "" ).replace( rhash, "" )
			.replace( rprotocol, ajaxLocParts[ 1 ] + "//" );

		// Alias method option to type as per ticket #12004
		s.type = options.method || options.type || s.method || s.type;

		// Extract dataTypes list
		s.dataTypes = jQuery.trim( s.dataType || "*" ).toLowerCase().match( rnotwhite ) || [ "" ];

		// A cross-domain request is in order when we have a protocol:host:port mismatch
		if ( s.crossDomain == null ) {
			parts = rurl.exec( s.url.toLowerCase() );
			s.crossDomain = !!( parts &&
				( parts[ 1 ] !== ajaxLocParts[ 1 ] || parts[ 2 ] !== ajaxLocParts[ 2 ] ||
					( parts[ 3 ] || ( parts[ 1 ] === "http:" ? "80" : "443" ) ) !==
						( ajaxLocParts[ 3 ] || ( ajaxLocParts[ 1 ] === "http:" ? "80" : "443" ) ) )
			);
		}

		// Convert data if not already a string
		if ( s.data && s.processData && typeof s.data !== "string" ) {
			s.data = jQuery.param( s.data, s.traditional );
		}

		// Apply prefilters
		inspectPrefiltersOrTransports( prefilters, s, options, jqXHR );

		// If request was aborted inside a prefilter, stop there
		if ( state === 2 ) {
			return jqXHR;
		}

		// We can fire global events as of now if asked to
		fireGlobals = s.global;

		// Watch for a new set of requests
		if ( fireGlobals && jQuery.active++ === 0 ) {
			jQuery.event.trigger("ajaxStart");
		}

		// Uppercase the type
		s.type = s.type.toUpperCase();

		// Determine if request has content
		s.hasContent = !rnoContent.test( s.type );

		// Save the URL in case we're toying with the If-Modified-Since
		// and/or If-None-Match header later on
		cacheURL = s.url;

		// More options handling for requests with no content
		if ( !s.hasContent ) {

			// If data is available, append data to url
			if ( s.data ) {
				cacheURL = ( s.url += ( rquery.test( cacheURL ) ? "&" : "?" ) + s.data );
				// #9682: remove data so that it's not used in an eventual retry
				delete s.data;
			}

			// Add anti-cache in url if needed
			if ( s.cache === false ) {
				s.url = rts.test( cacheURL ) ?

					// If there is already a '_' parameter, set its value
					cacheURL.replace( rts, "$1_=" + nonce++ ) :

					// Otherwise add one to the end
					cacheURL + ( rquery.test( cacheURL ) ? "&" : "?" ) + "_=" + nonce++;
			}
		}

		// Set the If-Modified-Since and/or If-None-Match header, if in ifModified mode.
		if ( s.ifModified ) {
			if ( jQuery.lastModified[ cacheURL ] ) {
				jqXHR.setRequestHeader( "If-Modified-Since", jQuery.lastModified[ cacheURL ] );
			}
			if ( jQuery.etag[ cacheURL ] ) {
				jqXHR.setRequestHeader( "If-None-Match", jQuery.etag[ cacheURL ] );
			}
		}

		// Set the correct header, if data is being sent
		if ( s.data && s.hasContent && s.contentType !== false || options.contentType ) {
			jqXHR.setRequestHeader( "Content-Type", s.contentType );
		}

		// Set the Accepts header for the server, depending on the dataType
		jqXHR.setRequestHeader(
			"Accept",
			s.dataTypes[ 0 ] && s.accepts[ s.dataTypes[0] ] ?
				s.accepts[ s.dataTypes[0] ] + ( s.dataTypes[ 0 ] !== "*" ? ", " + allTypes + "; q=0.01" : "" ) :
				s.accepts[ "*" ]
		);

		// Check for headers option
		for ( i in s.headers ) {
			jqXHR.setRequestHeader( i, s.headers[ i ] );
		}

		// Allow custom headers/mimetypes and early abort
		if ( s.beforeSend && ( s.beforeSend.call( callbackContext, jqXHR, s ) === false || state === 2 ) ) {
			// Abort if not done already and return
			return jqXHR.abort();
		}

		// aborting is no longer a cancellation
		strAbort = "abort";

		// Install callbacks on deferreds
		for ( i in { success: 1, error: 1, complete: 1 } ) {
			jqXHR[ i ]( s[ i ] );
		}

		// Get transport
		transport = inspectPrefiltersOrTransports( transports, s, options, jqXHR );

		// If no transport, we auto-abort
		if ( !transport ) {
			done( -1, "No Transport" );
		} else {
			jqXHR.readyState = 1;

			// Send global event
			if ( fireGlobals ) {
				globalEventContext.trigger( "ajaxSend", [ jqXHR, s ] );
			}
			// Timeout
			if ( s.async && s.timeout > 0 ) {
				timeoutTimer = setTimeout(function() {
					jqXHR.abort("timeout");
				}, s.timeout );
			}

			try {
				state = 1;
				transport.send( requestHeaders, done );
			} catch ( e ) {
				// Propagate exception as error if not done
				if ( state < 2 ) {
					done( -1, e );
				// Simply rethrow otherwise
				} else {
					throw e;
				}
			}
		}

		// Callback for when everything is done
		function done( status, nativeStatusText, responses, headers ) {
			var isSuccess, success, error, response, modified,
				statusText = nativeStatusText;

			// Called once
			if ( state === 2 ) {
				return;
			}

			// State is "done" now
			state = 2;

			// Clear timeout if it exists
			if ( timeoutTimer ) {
				clearTimeout( timeoutTimer );
			}

			// Dereference transport for early garbage collection
			// (no matter how long the jqXHR object will be used)
			transport = undefined;

			// Cache response headers
			responseHeadersString = headers || "";

			// Set readyState
			jqXHR.readyState = status > 0 ? 4 : 0;

			// Determine if successful
			isSuccess = status >= 200 && status < 300 || status === 304;

			// Get response data
			if ( responses ) {
				response = ajaxHandleResponses( s, jqXHR, responses );
			}

			// Convert no matter what (that way responseXXX fields are always set)
			response = ajaxConvert( s, response, jqXHR, isSuccess );

			// If successful, handle type chaining
			if ( isSuccess ) {

				// Set the If-Modified-Since and/or If-None-Match header, if in ifModified mode.
				if ( s.ifModified ) {
					modified = jqXHR.getResponseHeader("Last-Modified");
					if ( modified ) {
						jQuery.lastModified[ cacheURL ] = modified;
					}
					modified = jqXHR.getResponseHeader("etag");
					if ( modified ) {
						jQuery.etag[ cacheURL ] = modified;
					}
				}

				// if no content
				if ( status === 204 || s.type === "HEAD" ) {
					statusText = "nocontent";

				// if not modified
				} else if ( status === 304 ) {
					statusText = "notmodified";

				// If we have data, let's convert it
				} else {
					statusText = response.state;
					success = response.data;
					error = response.error;
					isSuccess = !error;
				}
			} else {
				// We extract error from statusText
				// then normalize statusText and status for non-aborts
				error = statusText;
				if ( status || !statusText ) {
					statusText = "error";
					if ( status < 0 ) {
						status = 0;
					}
				}
			}

			// Set data for the fake xhr object
			jqXHR.status = status;
			jqXHR.statusText = ( nativeStatusText || statusText ) + "";

			// Success/Error
			if ( isSuccess ) {
				deferred.resolveWith( callbackContext, [ success, statusText, jqXHR ] );
			} else {
				deferred.rejectWith( callbackContext, [ jqXHR, statusText, error ] );
			}

			// Status-dependent callbacks
			jqXHR.statusCode( statusCode );
			statusCode = undefined;

			if ( fireGlobals ) {
				globalEventContext.trigger( isSuccess ? "ajaxSuccess" : "ajaxError",
					[ jqXHR, s, isSuccess ? success : error ] );
			}

			// Complete
			completeDeferred.fireWith( callbackContext, [ jqXHR, statusText ] );

			if ( fireGlobals ) {
				globalEventContext.trigger( "ajaxComplete", [ jqXHR, s ] );
				// Handle the global AJAX counter
				if ( !( --jQuery.active ) ) {
					jQuery.event.trigger("ajaxStop");
				}
			}
		}

		return jqXHR;
	},

	getJSON: function( url, data, callback ) {
		return jQuery.get( url, data, callback, "json" );
	},

	getScript: function( url, callback ) {
		return jQuery.get( url, undefined, callback, "script" );
	}
});

jQuery.each( [ "get", "post" ], function( i, method ) {
	jQuery[ method ] = function( url, data, callback, type ) {
		// shift arguments if data argument was omitted
		if ( jQuery.isFunction( data ) ) {
			type = type || callback;
			callback = data;
			data = undefined;
		}

		return jQuery.ajax({
			url: url,
			type: method,
			dataType: type,
			data: data,
			success: callback
		});
	};
});

// Attach a bunch of functions for handling common AJAX events
jQuery.each( [ "ajaxStart", "ajaxStop", "ajaxComplete", "ajaxError", "ajaxSuccess", "ajaxSend" ], function( i, type ) {
	jQuery.fn[ type ] = function( fn ) {
		return this.on( type, fn );
	};
});


jQuery._evalUrl = function( url ) {
	return jQuery.ajax({
		url: url,
		type: "GET",
		dataType: "script",
		async: false,
		global: false,
		"throws": true
	});
};


jQuery.fn.extend({
	wrapAll: function( html ) {
		var wrap;

		if ( jQuery.isFunction( html ) ) {
			return this.each(function( i ) {
				jQuery( this ).wrapAll( html.call(this, i) );
			});
		}

		if ( this[ 0 ] ) {

			// The elements to wrap the target around
			wrap = jQuery( html, this[ 0 ].ownerDocument ).eq( 0 ).clone( true );

			if ( this[ 0 ].parentNode ) {
				wrap.insertBefore( this[ 0 ] );
			}

			wrap.map(function() {
				var elem = this;

				while ( elem.firstElementChild ) {
					elem = elem.firstElementChild;
				}

				return elem;
			}).append( this );
		}

		return this;
	},

	wrapInner: function( html ) {
		if ( jQuery.isFunction( html ) ) {
			return this.each(function( i ) {
				jQuery( this ).wrapInner( html.call(this, i) );
			});
		}

		return this.each(function() {
			var self = jQuery( this ),
				contents = self.contents();

			if ( contents.length ) {
				contents.wrapAll( html );

			} else {
				self.append( html );
			}
		});
	},

	wrap: function( html ) {
		var isFunction = jQuery.isFunction( html );

		return this.each(function( i ) {
			jQuery( this ).wrapAll( isFunction ? html.call(this, i) : html );
		});
	},

	unwrap: function() {
		return this.parent().each(function() {
			if ( !jQuery.nodeName( this, "body" ) ) {
				jQuery( this ).replaceWith( this.childNodes );
			}
		}).end();
	}
});


jQuery.expr.filters.hidden = function( elem ) {
	// Support: Opera <= 12.12
	// Opera reports offsetWidths and offsetHeights less than zero on some elements
	return elem.offsetWidth <= 0 && elem.offsetHeight <= 0;
};
jQuery.expr.filters.visible = function( elem ) {
	return !jQuery.expr.filters.hidden( elem );
};




var r20 = /%20/g,
	rbracket = /\[\]$/,
	rCRLF = /\r?\n/g,
	rsubmitterTypes = /^(?:submit|button|image|reset|file)$/i,
	rsubmittable = /^(?:input|select|textarea|keygen)/i;

function buildParams( prefix, obj, traditional, add ) {
	var name;

	if ( jQuery.isArray( obj ) ) {
		// Serialize array item.
		jQuery.each( obj, function( i, v ) {
			if ( traditional || rbracket.test( prefix ) ) {
				// Treat each array item as a scalar.
				add( prefix, v );

			} else {
				// Item is non-scalar (array or object), encode its numeric index.
				buildParams( prefix + "[" + ( typeof v === "object" ? i : "" ) + "]", v, traditional, add );
			}
		});

	} else if ( !traditional && jQuery.type( obj ) === "object" ) {
		// Serialize object item.
		for ( name in obj ) {
			buildParams( prefix + "[" + name + "]", obj[ name ], traditional, add );
		}

	} else {
		// Serialize scalar item.
		add( prefix, obj );
	}
}

// Serialize an array of form elements or a set of
// key/values into a query string
jQuery.param = function( a, traditional ) {
	var prefix,
		s = [],
		add = function( key, value ) {
			// If value is a function, invoke it and return its value
			value = jQuery.isFunction( value ) ? value() : ( value == null ? "" : value );
			s[ s.length ] = encodeURIComponent( key ) + "=" + encodeURIComponent( value );
		};

	// Set traditional to true for jQuery <= 1.3.2 behavior.
	if ( traditional === undefined ) {
		traditional = jQuery.ajaxSettings && jQuery.ajaxSettings.traditional;
	}

	// If an array was passed in, assume that it is an array of form elements.
	if ( jQuery.isArray( a ) || ( a.jquery && !jQuery.isPlainObject( a ) ) ) {
		// Serialize the form elements
		jQuery.each( a, function() {
			add( this.name, this.value );
		});

	} else {
		// If traditional, encode the "old" way (the way 1.3.2 or older
		// did it), otherwise encode params recursively.
		for ( prefix in a ) {
			buildParams( prefix, a[ prefix ], traditional, add );
		}
	}

	// Return the resulting serialization
	return s.join( "&" ).replace( r20, "+" );
};

jQuery.fn.extend({
	serialize: function() {
		return jQuery.param( this.serializeArray() );
	},
	serializeArray: function() {
		return this.map(function() {
			// Can add propHook for "elements" to filter or add form elements
			var elements = jQuery.prop( this, "elements" );
			return elements ? jQuery.makeArray( elements ) : this;
		})
		.filter(function() {
			var type = this.type;

			// Use .is( ":disabled" ) so that fieldset[disabled] works
			return this.name && !jQuery( this ).is( ":disabled" ) &&
				rsubmittable.test( this.nodeName ) && !rsubmitterTypes.test( type ) &&
				( this.checked || !rcheckableType.test( type ) );
		})
		.map(function( i, elem ) {
			var val = jQuery( this ).val();

			return val == null ?
				null :
				jQuery.isArray( val ) ?
					jQuery.map( val, function( val ) {
						return { name: elem.name, value: val.replace( rCRLF, "\r\n" ) };
					}) :
					{ name: elem.name, value: val.replace( rCRLF, "\r\n" ) };
		}).get();
	}
});


jQuery.ajaxSettings.xhr = function() {
	try {
		return new XMLHttpRequest();
	} catch( e ) {}
};

var xhrId = 0,
	xhrCallbacks = {},
	xhrSuccessStatus = {
		// file protocol always yields status code 0, assume 200
		0: 200,
		// Support: IE9
		// #1450: sometimes IE returns 1223 when it should be 204
		1223: 204
	},
	xhrSupported = jQuery.ajaxSettings.xhr();

// Support: IE9
// Open requests must be manually aborted on unload (#5280)
if ( window.ActiveXObject ) {
	jQuery( window ).on( "unload", function() {
		for ( var key in xhrCallbacks ) {
			xhrCallbacks[ key ]();
		}
	});
}

support.cors = !!xhrSupported && ( "withCredentials" in xhrSupported );
support.ajax = xhrSupported = !!xhrSupported;

jQuery.ajaxTransport(function( options ) {
	var callback;

	// Cross domain only allowed if supported through XMLHttpRequest
	if ( support.cors || xhrSupported && !options.crossDomain ) {
		return {
			send: function( headers, complete ) {
				var i,
					xhr = options.xhr(),
					id = ++xhrId;

				xhr.open( options.type, options.url, options.async, options.username, options.password );

				// Apply custom fields if provided
				if ( options.xhrFields ) {
					for ( i in options.xhrFields ) {
						xhr[ i ] = options.xhrFields[ i ];
					}
				}

				// Override mime type if needed
				if ( options.mimeType && xhr.overrideMimeType ) {
					xhr.overrideMimeType( options.mimeType );
				}

				// X-Requested-With header
				// For cross-domain requests, seeing as conditions for a preflight are
				// akin to a jigsaw puzzle, we simply never set it to be sure.
				// (it can always be set on a per-request basis or even using ajaxSetup)
				// For same-domain requests, won't change header if already provided.
				if ( !options.crossDomain && !headers["X-Requested-With"] ) {
					headers["X-Requested-With"] = "XMLHttpRequest";
				}

				// Set headers
				for ( i in headers ) {
					xhr.setRequestHeader( i, headers[ i ] );
				}

				// Callback
				callback = function( type ) {
					return function() {
						if ( callback ) {
							delete xhrCallbacks[ id ];
							callback = xhr.onload = xhr.onerror = null;

							if ( type === "abort" ) {
								xhr.abort();
							} else if ( type === "error" ) {
								complete(
									// file: protocol always yields status 0; see #8605, #14207
									xhr.status,
									xhr.statusText
								);
							} else {
								complete(
									xhrSuccessStatus[ xhr.status ] || xhr.status,
									xhr.statusText,
									// Support: IE9
									// Accessing binary-data responseText throws an exception
									// (#11426)
									typeof xhr.responseText === "string" ? {
										text: xhr.responseText
									} : undefined,
									xhr.getAllResponseHeaders()
								);
							}
						}
					};
				};

				// Listen to events
				xhr.onload = callback();
				xhr.onerror = callback("error");

				// Create the abort callback
				callback = xhrCallbacks[ id ] = callback("abort");

				try {
					// Do send the request (this may raise an exception)
					xhr.send( options.hasContent && options.data || null );
				} catch ( e ) {
					// #14683: Only rethrow if this hasn't been notified as an error yet
					if ( callback ) {
						throw e;
					}
				}
			},

			abort: function() {
				if ( callback ) {
					callback();
				}
			}
		};
	}
});




// Install script dataType
jQuery.ajaxSetup({
	accepts: {
		script: "text/javascript, application/javascript, application/ecmascript, application/x-ecmascript"
	},
	contents: {
		script: /(?:java|ecma)script/
	},
	converters: {
		"text script": function( text ) {
			jQuery.globalEval( text );
			return text;
		}
	}
});

// Handle cache's special case and crossDomain
jQuery.ajaxPrefilter( "script", function( s ) {
	if ( s.cache === undefined ) {
		s.cache = false;
	}
	if ( s.crossDomain ) {
		s.type = "GET";
	}
});

// Bind script tag hack transport
jQuery.ajaxTransport( "script", function( s ) {
	// This transport only deals with cross domain requests
	if ( s.crossDomain ) {
		var script, callback;
		return {
			send: function( _, complete ) {
				script = jQuery("<script>").prop({
					async: true,
					charset: s.scriptCharset,
					src: s.url
				}).on(
					"load error",
					callback = function( evt ) {
						script.remove();
						callback = null;
						if ( evt ) {
							complete( evt.type === "error" ? 404 : 200, evt.type );
						}
					}
				);
				document.head.appendChild( script[ 0 ] );
			},
			abort: function() {
				if ( callback ) {
					callback();
				}
			}
		};
	}
});




var oldCallbacks = [],
	rjsonp = /(=)\?(?=&|$)|\?\?/;

// Default jsonp settings
jQuery.ajaxSetup({
	jsonp: "callback",
	jsonpCallback: function() {
		var callback = oldCallbacks.pop() || ( jQuery.expando + "_" + ( nonce++ ) );
		this[ callback ] = true;
		return callback;
	}
});

// Detect, normalize options and install callbacks for jsonp requests
jQuery.ajaxPrefilter( "json jsonp", function( s, originalSettings, jqXHR ) {

	var callbackName, overwritten, responseContainer,
		jsonProp = s.jsonp !== false && ( rjsonp.test( s.url ) ?
			"url" :
			typeof s.data === "string" && !( s.contentType || "" ).indexOf("application/x-www-form-urlencoded") && rjsonp.test( s.data ) && "data"
		);

	// Handle iff the expected data type is "jsonp" or we have a parameter to set
	if ( jsonProp || s.dataTypes[ 0 ] === "jsonp" ) {

		// Get callback name, remembering preexisting value associated with it
		callbackName = s.jsonpCallback = jQuery.isFunction( s.jsonpCallback ) ?
			s.jsonpCallback() :
			s.jsonpCallback;

		// Insert callback into url or form data
		if ( jsonProp ) {
			s[ jsonProp ] = s[ jsonProp ].replace( rjsonp, "$1" + callbackName );
		} else if ( s.jsonp !== false ) {
			s.url += ( rquery.test( s.url ) ? "&" : "?" ) + s.jsonp + "=" + callbackName;
		}

		// Use data converter to retrieve json after script execution
		s.converters["script json"] = function() {
			if ( !responseContainer ) {
				jQuery.error( callbackName + " was not called" );
			}
			return responseContainer[ 0 ];
		};

		// force json dataType
		s.dataTypes[ 0 ] = "json";

		// Install callback
		overwritten = window[ callbackName ];
		window[ callbackName ] = function() {
			responseContainer = arguments;
		};

		// Clean-up function (fires after converters)
		jqXHR.always(function() {
			// Restore preexisting value
			window[ callbackName ] = overwritten;

			// Save back as free
			if ( s[ callbackName ] ) {
				// make sure that re-using the options doesn't screw things around
				s.jsonpCallback = originalSettings.jsonpCallback;

				// save the callback name for future use
				oldCallbacks.push( callbackName );
			}

			// Call if it was a function and we have a response
			if ( responseContainer && jQuery.isFunction( overwritten ) ) {
				overwritten( responseContainer[ 0 ] );
			}

			responseContainer = overwritten = undefined;
		});

		// Delegate to script
		return "script";
	}
});




// data: string of html
// context (optional): If specified, the fragment will be created in this context, defaults to document
// keepScripts (optional): If true, will include scripts passed in the html string
jQuery.parseHTML = function( data, context, keepScripts ) {
	if ( !data || typeof data !== "string" ) {
		return null;
	}
	if ( typeof context === "boolean" ) {
		keepScripts = context;
		context = false;
	}
	context = context || document;

	var parsed = rsingleTag.exec( data ),
		scripts = !keepScripts && [];

	// Single tag
	if ( parsed ) {
		return [ context.createElement( parsed[1] ) ];
	}

	parsed = jQuery.buildFragment( [ data ], context, scripts );

	if ( scripts && scripts.length ) {
		jQuery( scripts ).remove();
	}

	return jQuery.merge( [], parsed.childNodes );
};


// Keep a copy of the old load method
var _load = jQuery.fn.load;

/**
 * Load a url into a page
 */
jQuery.fn.load = function( url, params, callback ) {
	if ( typeof url !== "string" && _load ) {
		return _load.apply( this, arguments );
	}

	var selector, type, response,
		self = this,
		off = url.indexOf(" ");

	if ( off >= 0 ) {
		selector = jQuery.trim( url.slice( off ) );
		url = url.slice( 0, off );
	}

	// If it's a function
	if ( jQuery.isFunction( params ) ) {

		// We assume that it's the callback
		callback = params;
		params = undefined;

	// Otherwise, build a param string
	} else if ( params && typeof params === "object" ) {
		type = "POST";
	}

	// If we have elements to modify, make the request
	if ( self.length > 0 ) {
		jQuery.ajax({
			url: url,

			// if "type" variable is undefined, then "GET" method will be used
			type: type,
			dataType: "html",
			data: params
		}).done(function( responseText ) {

			// Save response for use in complete callback
			response = arguments;

			self.html( selector ?

				// If a selector was specified, locate the right elements in a dummy div
				// Exclude scripts to avoid IE 'Permission Denied' errors
				jQuery("<div>").append( jQuery.parseHTML( responseText ) ).find( selector ) :

				// Otherwise use the full result
				responseText );

		}).complete( callback && function( jqXHR, status ) {
			self.each( callback, response || [ jqXHR.responseText, status, jqXHR ] );
		});
	}

	return this;
};




jQuery.expr.filters.animated = function( elem ) {
	return jQuery.grep(jQuery.timers, function( fn ) {
		return elem === fn.elem;
	}).length;
};




var docElem = window.document.documentElement;

/**
 * Gets a window from an element
 */
function getWindow( elem ) {
	return jQuery.isWindow( elem ) ? elem : elem.nodeType === 9 && elem.defaultView;
}

jQuery.offset = {
	setOffset: function( elem, options, i ) {
		var curPosition, curLeft, curCSSTop, curTop, curOffset, curCSSLeft, calculatePosition,
			position = jQuery.css( elem, "position" ),
			curElem = jQuery( elem ),
			props = {};

		// Set position first, in-case top/left are set even on static elem
		if ( position === "static" ) {
			elem.style.position = "relative";
		}

		curOffset = curElem.offset();
		curCSSTop = jQuery.css( elem, "top" );
		curCSSLeft = jQuery.css( elem, "left" );
		calculatePosition = ( position === "absolute" || position === "fixed" ) &&
			( curCSSTop + curCSSLeft ).indexOf("auto") > -1;

		// Need to be able to calculate position if either top or left is auto and position is either absolute or fixed
		if ( calculatePosition ) {
			curPosition = curElem.position();
			curTop = curPosition.top;
			curLeft = curPosition.left;

		} else {
			curTop = parseFloat( curCSSTop ) || 0;
			curLeft = parseFloat( curCSSLeft ) || 0;
		}

		if ( jQuery.isFunction( options ) ) {
			options = options.call( elem, i, curOffset );
		}

		if ( options.top != null ) {
			props.top = ( options.top - curOffset.top ) + curTop;
		}
		if ( options.left != null ) {
			props.left = ( options.left - curOffset.left ) + curLeft;
		}

		if ( "using" in options ) {
			options.using.call( elem, props );

		} else {
			curElem.css( props );
		}
	}
};

jQuery.fn.extend({
	offset: function( options ) {
		if ( arguments.length ) {
			return options === undefined ?
				this :
				this.each(function( i ) {
					jQuery.offset.setOffset( this, options, i );
				});
		}

		var docElem, win,
			elem = this[ 0 ],
			box = { top: 0, left: 0 },
			doc = elem && elem.ownerDocument;

		if ( !doc ) {
			return;
		}

		docElem = doc.documentElement;

		// Make sure it's not a disconnected DOM node
		if ( !jQuery.contains( docElem, elem ) ) {
			return box;
		}

		// If we don't have gBCR, just use 0,0 rather than error
		// BlackBerry 5, iOS 3 (original iPhone)
		if ( typeof elem.getBoundingClientRect !== strundefined ) {
			box = elem.getBoundingClientRect();
		}
		win = getWindow( doc );
		return {
			top: box.top + win.pageYOffset - docElem.clientTop,
			left: box.left + win.pageXOffset - docElem.clientLeft
		};
	},

	position: function() {
		if ( !this[ 0 ] ) {
			return;
		}

		var offsetParent, offset,
			elem = this[ 0 ],
			parentOffset = { top: 0, left: 0 };

		// Fixed elements are offset from window (parentOffset = {top:0, left: 0}, because it is its only offset parent
		if ( jQuery.css( elem, "position" ) === "fixed" ) {
			// We assume that getBoundingClientRect is available when computed position is fixed
			offset = elem.getBoundingClientRect();

		} else {
			// Get *real* offsetParent
			offsetParent = this.offsetParent();

			// Get correct offsets
			offset = this.offset();
			if ( !jQuery.nodeName( offsetParent[ 0 ], "html" ) ) {
				parentOffset = offsetParent.offset();
			}

			// Add offsetParent borders
			parentOffset.top += jQuery.css( offsetParent[ 0 ], "borderTopWidth", true );
			parentOffset.left += jQuery.css( offsetParent[ 0 ], "borderLeftWidth", true );
		}

		// Subtract parent offsets and element margins
		return {
			top: offset.top - parentOffset.top - jQuery.css( elem, "marginTop", true ),
			left: offset.left - parentOffset.left - jQuery.css( elem, "marginLeft", true )
		};
	},

	offsetParent: function() {
		return this.map(function() {
			var offsetParent = this.offsetParent || docElem;

			while ( offsetParent && ( !jQuery.nodeName( offsetParent, "html" ) && jQuery.css( offsetParent, "position" ) === "static" ) ) {
				offsetParent = offsetParent.offsetParent;
			}

			return offsetParent || docElem;
		});
	}
});

// Create scrollLeft and scrollTop methods
jQuery.each( { scrollLeft: "pageXOffset", scrollTop: "pageYOffset" }, function( method, prop ) {
	var top = "pageYOffset" === prop;

	jQuery.fn[ method ] = function( val ) {
		return access( this, function( elem, method, val ) {
			var win = getWindow( elem );

			if ( val === undefined ) {
				return win ? win[ prop ] : elem[ method ];
			}

			if ( win ) {
				win.scrollTo(
					!top ? val : window.pageXOffset,
					top ? val : window.pageYOffset
				);

			} else {
				elem[ method ] = val;
			}
		}, method, val, arguments.length, null );
	};
});

// Add the top/left cssHooks using jQuery.fn.position
// Webkit bug: https://bugs.webkit.org/show_bug.cgi?id=29084
// getComputedStyle returns percent when specified for top/left/bottom/right
// rather than make the css module depend on the offset module, we just check for it here
jQuery.each( [ "top", "left" ], function( i, prop ) {
	jQuery.cssHooks[ prop ] = addGetHookIf( support.pixelPosition,
		function( elem, computed ) {
			if ( computed ) {
				computed = curCSS( elem, prop );
				// if curCSS returns percentage, fallback to offset
				return rnumnonpx.test( computed ) ?
					jQuery( elem ).position()[ prop ] + "px" :
					computed;
			}
		}
	);
});


// Create innerHeight, innerWidth, height, width, outerHeight and outerWidth methods
jQuery.each( { Height: "height", Width: "width" }, function( name, type ) {
	jQuery.each( { padding: "inner" + name, content: type, "": "outer" + name }, function( defaultExtra, funcName ) {
		// margin is only for outerHeight, outerWidth
		jQuery.fn[ funcName ] = function( margin, value ) {
			var chainable = arguments.length && ( defaultExtra || typeof margin !== "boolean" ),
				extra = defaultExtra || ( margin === true || value === true ? "margin" : "border" );

			return access( this, function( elem, type, value ) {
				var doc;

				if ( jQuery.isWindow( elem ) ) {
					// As of 5/8/2012 this will yield incorrect results for Mobile Safari, but there
					// isn't a whole lot we can do. See pull request at this URL for discussion:
					// https://github.com/jquery/jquery/pull/764
					return elem.document.documentElement[ "client" + name ];
				}

				// Get document width or height
				if ( elem.nodeType === 9 ) {
					doc = elem.documentElement;

					// Either scroll[Width/Height] or offset[Width/Height] or client[Width/Height],
					// whichever is greatest
					return Math.max(
						elem.body[ "scroll" + name ], doc[ "scroll" + name ],
						elem.body[ "offset" + name ], doc[ "offset" + name ],
						doc[ "client" + name ]
					);
				}

				return value === undefined ?
					// Get width or height on the element, requesting but not forcing parseFloat
					jQuery.css( elem, type, extra ) :

					// Set width or height on the element
					jQuery.style( elem, type, value, extra );
			}, type, chainable ? margin : undefined, chainable, null );
		};
	});
});


// The number of elements contained in the matched element set
jQuery.fn.size = function() {
	return this.length;
};

jQuery.fn.andSelf = jQuery.fn.addBack;




// Register as a named AMD module, since jQuery can be concatenated with other
// files that may use define, but not via a proper concatenation script that
// understands anonymous AMD modules. A named AMD is safest and most robust
// way to register. Lowercase jquery is used because AMD module names are
// derived from file names, and jQuery is normally delivered in a lowercase
// file name. Do this after creating the global so that if an AMD module wants
// to call noConflict to hide this version of jQuery, it will work.

// Note that for maximum portability, libraries that are not jQuery should
// declare themselves as anonymous modules, and avoid setting a global if an
// AMD loader is present. jQuery is a special case. For more information, see
// https://github.com/jrburke/requirejs/wiki/Updating-existing-libraries#wiki-anon

if ( typeof define === "function" && define.amd ) {
	define( "jquery", [], function() {
		return jQuery;
	});
}




var
	// Map over jQuery in case of overwrite
	_jQuery = window.jQuery,

	// Map over the $ in case of overwrite
	_$ = window.$;

jQuery.noConflict = function( deep ) {
	if ( window.$ === jQuery ) {
		window.$ = _$;
	}

	if ( deep && window.jQuery === jQuery ) {
		window.jQuery = _jQuery;
	}

	return jQuery;
};

// Expose jQuery and $ identifiers, even in
// AMD (#7102#comment:10, https://github.com/jquery/jquery/pull/557)
// and CommonJS for browser emulators (#13566)
if ( typeof noGlobal === strundefined ) {
	window.jQuery = window.$ = jQuery;
}




return jQuery;

}));

// Concerto Base Libraries.
// Taehoon Moon <panarch@kaist.ac.kr>
//
// Converter
//
// Copyright Taehoon Moon 2014

define('Converter',['require','exports','module','js-logger','jquery'],function(require, exports, module) {
    var L = require('js-logger').get('Converter');
    var $ = require('jquery');

    function Converter() {}

    Converter.getIdentification = function getIdentification($xml) {
        var $identification = $xml.find('identification');
        var $encoding = $identification.find('encoding');
        var identification = {
            'encoding': {
                'software': $encoding.find('software').text(),
                'encoding-date': $encoding.find('encoding-date').text()
            }
        };

        return identification;
    };

    Converter.getDefaults = function getDefaults($xml) {
        var $defaults = $xml.find('defaults');
        var $scaling = $defaults.find('scaling');
        var scaling = {
            'millimeters': parseFloat($scaling.find('millimeters').text()),
            'tenths': parseFloat($scaling.find('tenths').text())
        };

        var $pageLayout = $defaults.find('page-layout');
        var pageLayout = {
            'page-height': parseFloat($pageLayout.find('page-height').text()),
            'page-width': parseFloat($pageLayout.find('page-width').text()),
            'page-margins': []
        };
        var $pageMargins = $defaults.find('page-margins');
        $pageMargins.each(function() {
            var pageMargin = {};
            if ($(this).attr('type'))
                pageMargin['@type'] = $(this).attr('type');
            else
                pageMargin['@type'] = 'both';

            pageMargin['left-margin'] = parseFloat($(this).find('left-margin').text());
            pageMargin['right-margin'] = parseFloat($(this).find('right-margin').text());
            pageMargin['top-margin'] = parseFloat($(this).find('top-margin').text());
            pageMargin['bottom-margin'] = parseFloat($(this).find('bottom-margin').text());

            pageLayout['page-margins'].push(pageMargin);
        });

        var defaults = {
            'scaling': scaling,
            'page-layout': pageLayout
        };

        return defaults;
    };

    Converter.getPartList = function getPartList($xml) {
        var partList = [];
        // part-group
        // score-part
        $xml.find('part-list').children().each(function() {
            if ($(this).prop('tagName') === 'part-group') {
                var partGroup = {
                    'tag': 'part-group'
                };
                partGroup['@type'] = $(this).attr('type');
                partGroup['@number'] = parseInt($(this).attr('number'));
                partGroup['group-symbol'] = $(this).find('group-symbol').text();

                partList.push(partGroup);
            }
            else if ($(this).prop('tagName') === 'score-part') {
                var scorePart = {
                    'tag': 'score-part'
                };
                scorePart['@id'] = $(this).attr('id');
                scorePart['part-name'] = $(this).find('part-name').text();

                var $scoreInstrument = $(this).find('score-instrument');
                scorePart['score-instrument'] = {
                    '@id': $scoreInstrument.attr('id'),
                    'instrument-name': $scoreInstrument.find('instrument-name').text()
                };

                var $midiInstrument = $(this).find('midi-instrument');
                scorePart['midi-instrument'] = {
                    '@id': $midiInstrument.attr('id'),
                    'midi-channel': parseInt($midiInstrument.find('midi-channel').text()),
                    'midi-program': parseInt($midiInstrument.find('midi-program').text())
                };

                partList.push(scorePart);
            }
            else
                L.error('Unsupported part-list children tags');
        });

        return partList;
    };

    Converter.getPrintTag = function getPrintTag($print) {
        var print = {};
        if ($print.attr('new-page') === 'yes')
            print['@new-page'] = true;
        else if ($print.attr('new-system') === 'yes')
            print['@new-system'] = true;

        if ($print.find('system-layout').length > 0) {
            var $systemLayout = $print.find('system-layout');
            var $systemMargins = $systemLayout.find('system-margins');
            var systemLayout = {
                'system-margins': {
                    'left-margin': parseFloat($systemMargins.find('left-margin').text()),
                    'right-margin': parseFloat($systemMargins.find('right-margin').text())
                }
            };

            if ($systemLayout.find('top-system-distance').length > 0)
                systemLayout['top-system-distance'] = parseFloat($systemLayout.find('top-system-distance').text());
            else if ($systemLayout.find('system-distance').length > 0)
                systemLayout['system-distance'] = parseFloat($systemLayout.find('system-distance').text());

            print['system-layout'] = systemLayout;
        }

        if ($print.find('staff-layout').length > 0) {
            // musicxml xsd says staff-layout maxOccurs is unbounded.
            // but I haven't found this case which multiple staff-layout occurs in an one print tag.
            // --> It can be possible when three staff occurs...
            // --> It was my mistake, staff-layout can occur multiple times.
            print['staff-layout'] = [];

            $print.find('staff-layout').each(function() {
                var staffLayout = {
                    '@number': parseInt($(this).attr('number')),
                    'staff-distance': parseFloat($(this).find('staff-distance').text())
                };
                print['staff-layout'].push(staffLayout);
            });
        }
        return print;
    };

    Converter.getAttributesTag = function getAttributesTag($attributes) {
        var attributes = {
            'tag': 'attributes'
        };

        var $divisions = $attributes.find('divisions');
        if ($divisions.length > 0)
            attributes['divisions'] = parseInt($divisions.text());

        var $staves = $attributes.find('staves');
        if ($staves.length > 0)
            attributes['staves'] = parseInt($staves.text());

        var $clef = $attributes.find('clef');
        if ($clef.length > 0) {
            var clefs = [];
            $clef.each(function() {
                var clef = {
                    'sign': $(this).find('sign').text(),
                    'line': parseInt($(this).find('line').text())
                };
                if ($(this).attr('number'))
                    clef['@number'] = parseInt($(this).attr('number'));

                clefs.push(clef);
            });

            if (clefs.length > 0)
                attributes['clef'] = clefs;
        }

        var $time = $attributes.find('time');
        if ($time.length > 0) {
            attributes['time'] = {
                'beats': parseInt($time.find('beats').text()),
                'beat-type': parseInt($time.find('beat-type').text())
            };

            if ($time.attr('symbol'))
                attributes['time']['@symbol'] = $time.attr('symbol');
        }

        var $key = $attributes.find('key');
        if ($key.length > 0) {
            attributes['key'] = {
                'fifths': parseInt($key.find('fifths').text())
            };

            if ($key.find('mode').length > 0)
                attributes['mode'] = $key.find('mode').text();
        }

        return attributes;
    };

    Converter.getNoteTag = function getNoteTag($note) {
        var note = {
            'tag': 'note'
        };

        note['duration'] = parseInt($note.find('duration').text());
        if ($note.find('type').length > 0)
            note['type'] = $note.find('type').text();

        var $accidental = $note.find('accidental');
        if ($accidental.length > 0)
            note['accidental'] = $accidental.text();

        if ($note.find('rest').length > 0)
            note['rest'] = true;
        else {
            var $stem = $note.find('stem');
            /***
             *  |
             *  |
             * O   --> down

             * O
             *  |
             *  |   --> up
             **/
            if ($stem.length > 0)
                note['stem'] = ($stem.text() === 'down') ? 'up' : 'down';

            if ($note.find('chord').length > 0)
                note['chord'] = true;

            var $beam = $note.find('beam');
            if ($beam.length !== 0) {
                note['beam'] = [];
                $beam.each(function() {
                    var beam = {};
                    beam['@number'] = $(this).attr('number');
                    beam['text'] = $(this).text();
                    note['beam'].push(beam);
                });
            }
        }

        if ($note.find('pitch').length > 0) {
            var $pitch = $note.find('pitch');
            note['pitch'] = {
                'step': $pitch.find('step').text(),
                'octave': parseInt($pitch.find('octave').text())
            };

            if ($pitch.find('alter').length > 0)
                note['pitch']['alter'] = parseInt($pitch.find('alter').text());
        }

        var $dot = $note.find('dot');
        if ($dot.length > 0)
            note['dot'] = $dot.length;

        var $voice = $note.find('voice');
        if ($voice.length > 0)
            note['voice'] = parseInt($voice.text());

        var $staff = $note.find('staff');
        if ($staff.length > 0)
            note['staff'] = parseInt($staff.text());

        var $notations = $note.find('notations');
        if ($notations.length > 0) {
            note['notations'] = {};

            // fermata
            var $fermata = $notations.find('fermata');
            if ($fermata.length > 0) {
                var fermata = {};
                if ($fermata.attr('type'))
                    fermata['@type'] = $fermata.attr('type');
                else
                    fermata['@type'] = 'upright';
                note['notations']['fermata'] = fermata;
            }

            // technical
            var $technical = $notations.find('technical');
            if ($technical.length > 0) {
                var technical = [];
                $technical.children().each(function() {
                    technical.push({
                        'tag': $(this).prop('tagName')
                    });
                });
                note['notations']['technical'] = technical;
            }

            // articulations
            var $articulations = $notations.find('articulations');
            if ($articulations.length > 0) {
                var articulations = [];
                $articulations.children().each(function() {
                    articulations.push({
                        'tag': $(this).prop('tagName')
                    });
                });
                note['notations']['articulations'] = articulations;
            }
        }

        return note;
    };

    Converter.getForwardAndBackupTag = function getForwardAndBackupTag($elem) {
        var elem = {
            'tag': $elem.prop('tagName'),
            'duration': parseInt($elem.find('duration').text())
        };
        return elem;
    };

    Converter.getBarlineTag = function getBarlineTag($barline) {
        var barline = {
            'tag': $barline.prop('tagName'),
            'bar-style': $barline.find('bar-style').text()
        };

        if ($barline.find('repeat').length > 0)
            barline['repeat'] = {
                '@direction': $barline.find('repeat').attr('direction')
            };

        var barlineLocation = $barline.attr('location');
        if (barlineLocation === 'left')
            barline['@location'] = 'left';
        else if (barlineLocation === 'middle')
            L.warn('Unhandled barline @location - middle');
        else
            barline['@location'] = 'right';

        return barline;
    };

    Converter.getPart = function getPart($xml) {
        var parts = [];
        var $parts = $xml.find('part');

        $parts.each(function() {
            var part = {
                '@id': $(this).attr('id'),
                'measure': []
            };

            $(this).find('measure').each(function() {
                var measure = {
                    '@number': parseInt($(this).attr('number')),
                    'width': parseFloat($(this).attr('width')) ,
                    'note': [],
                    'barline': {}
                };

                $(this).children().each(function() {
                    // print, note, attributes, backward, forward, barline
                    var tagName = $(this).prop('tagName');
                    if (tagName === 'print')
                        measure['print'] = Converter.getPrintTag($(this));
                    else if (tagName === 'attributes')
                        measure['note'].push(Converter.getAttributesTag($(this)));
                    else if (tagName === 'note')
                        measure['note'].push(Converter.getNoteTag($(this)));
                    else if (tagName === 'backup' || tagName === 'forward')
                        measure['note'].push(Converter.getForwardAndBackupTag($(this)));
                    else if (tagName === 'barline') {
                        // should decide whether left or right barline.
                        var barline = Converter.getBarlineTag($(this));
                        if (barline['@location'] === 'left')
                            measure['barline']['left-barline'] = barline;
                        else
                            measure['barline']['right-barline'] = barline;
                    }
                    else
                        L.error('Unsupported note tagname : ' + tagName);
                });

                part['measure'].push(measure);
            });
            parts.push(part);
        });

        return parts;
    };

    Converter.toJSON = function toJSON(musicxml) {
        var musicjson = {};

        //var xmlDoc = $.parseXML(musicxml);
        //var $xml = $(xmlDoc);
        var $xml = $(musicxml);

        musicjson['identification'] = Converter.getIdentification($xml);
        musicjson['defaults'] = Converter.getDefaults($xml);
        musicjson['part-list'] = Converter.getPartList($xml);
        musicjson['part'] = Converter.getPart($xml);

        return musicjson;
    };

    Converter.toXML = function toXML(musicjson) {
        var musicxml = '';
        return musicxml;
    };

    module.exports = Converter;
});

// ┌────────────────────────────────────────────────────────────────────┐ \\
// │ Raphaël 2.1.1 - JavaScript Vector Library                          │ \\
// ├────────────────────────────────────────────────────────────────────┤ \\
// │ Copyright © 2008-2012 Dmitry Baranovskiy (http://raphaeljs.com)    │ \\
// │ Copyright © 2008-2012 Sencha Labs (http://sencha.com)              │ \\
// ├────────────────────────────────────────────────────────────────────┤ \\
// │ Licensed under the MIT (http://raphaeljs.com/license.html) license.│ \\
// └────────────────────────────────────────────────────────────────────┘ \\
// Copyright (c) 2013 Adobe Systems Incorporated. All rights reserved.
// 
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
// 
// http://www.apache.org/licenses/LICENSE-2.0
// 
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ┌────────────────────────────────────────────────────────────┐ \\
// │ Eve 0.4.2 - JavaScript Events Library                      │ \\
// ├────────────────────────────────────────────────────────────┤ \\
// │ Author Dmitry Baranovskiy (http://dmitry.baranovskiy.com/) │ \\
// └────────────────────────────────────────────────────────────┘ \\

(function (glob) {
    var version = "0.4.2",
        has = "hasOwnProperty",
        separator = /[\.\/]/,
        wildcard = "*",
        fun = function () {},
        numsort = function (a, b) {
            return a - b;
        },
        current_event,
        stop,
        events = {n: {}},
    /*\
     * eve
     [ method ]

     * Fires event with given `name`, given scope and other parameters.

     > Arguments

     - name (string) name of the *event*, dot (`.`) or slash (`/`) separated
     - scope (object) context for the event handlers
     - varargs (...) the rest of arguments will be sent to event handlers

     = (object) array of returned values from the listeners
    \*/
        eve = function (name, scope) {
			name = String(name);
            var e = events,
                oldstop = stop,
                args = Array.prototype.slice.call(arguments, 2),
                listeners = eve.listeners(name),
                z = 0,
                f = false,
                l,
                indexed = [],
                queue = {},
                out = [],
                ce = current_event,
                errors = [];
            current_event = name;
            stop = 0;
            for (var i = 0, ii = listeners.length; i < ii; i++) if ("zIndex" in listeners[i]) {
                indexed.push(listeners[i].zIndex);
                if (listeners[i].zIndex < 0) {
                    queue[listeners[i].zIndex] = listeners[i];
                }
            }
            indexed.sort(numsort);
            while (indexed[z] < 0) {
                l = queue[indexed[z++]];
                out.push(l.apply(scope, args));
                if (stop) {
                    stop = oldstop;
                    return out;
                }
            }
            for (i = 0; i < ii; i++) {
                l = listeners[i];
                if ("zIndex" in l) {
                    if (l.zIndex == indexed[z]) {
                        out.push(l.apply(scope, args));
                        if (stop) {
                            break;
                        }
                        do {
                            z++;
                            l = queue[indexed[z]];
                            l && out.push(l.apply(scope, args));
                            if (stop) {
                                break;
                            }
                        } while (l)
                    } else {
                        queue[l.zIndex] = l;
                    }
                } else {
                    out.push(l.apply(scope, args));
                    if (stop) {
                        break;
                    }
                }
            }
            stop = oldstop;
            current_event = ce;
            return out.length ? out : null;
        };
		// Undocumented. Debug only.
		eve._events = events;
    /*\
     * eve.listeners
     [ method ]

     * Internal method which gives you array of all event handlers that will be triggered by the given `name`.

     > Arguments

     - name (string) name of the event, dot (`.`) or slash (`/`) separated

     = (array) array of event handlers
    \*/
    eve.listeners = function (name) {
        var names = name.split(separator),
            e = events,
            item,
            items,
            k,
            i,
            ii,
            j,
            jj,
            nes,
            es = [e],
            out = [];
        for (i = 0, ii = names.length; i < ii; i++) {
            nes = [];
            for (j = 0, jj = es.length; j < jj; j++) {
                e = es[j].n;
                items = [e[names[i]], e[wildcard]];
                k = 2;
                while (k--) {
                    item = items[k];
                    if (item) {
                        nes.push(item);
                        out = out.concat(item.f || []);
                    }
                }
            }
            es = nes;
        }
        return out;
    };
    
    /*\
     * eve.on
     [ method ]
     **
     * Binds given event handler with a given name. You can use wildcards “`*`” for the names:
     | eve.on("*.under.*", f);
     | eve("mouse.under.floor"); // triggers f
     * Use @eve to trigger the listener.
     **
     > Arguments
     **
     - name (string) name of the event, dot (`.`) or slash (`/`) separated, with optional wildcards
     - f (function) event handler function
     **
     = (function) returned function accepts a single numeric parameter that represents z-index of the handler. It is an optional feature and only used when you need to ensure that some subset of handlers will be invoked in a given order, despite of the order of assignment. 
     > Example:
     | eve.on("mouse", eatIt)(2);
     | eve.on("mouse", scream);
     | eve.on("mouse", catchIt)(1);
     * This will ensure that `catchIt()` function will be called before `eatIt()`.
	 *
     * If you want to put your handler before non-indexed handlers, specify a negative value.
     * Note: I assume most of the time you don’t need to worry about z-index, but it’s nice to have this feature “just in case”.
    \*/
    eve.on = function (name, f) {
		name = String(name);
		if (typeof f != "function") {
			return function () {};
		}
        var names = name.split(separator),
            e = events;
        for (var i = 0, ii = names.length; i < ii; i++) {
            e = e.n;
            e = e.hasOwnProperty(names[i]) && e[names[i]] || (e[names[i]] = {n: {}});
        }
        e.f = e.f || [];
        for (i = 0, ii = e.f.length; i < ii; i++) if (e.f[i] == f) {
            return fun;
        }
        e.f.push(f);
        return function (zIndex) {
            if (+zIndex == +zIndex) {
                f.zIndex = +zIndex;
            }
        };
    };
    /*\
     * eve.f
     [ method ]
     **
     * Returns function that will fire given event with optional arguments.
	 * Arguments that will be passed to the result function will be also
	 * concated to the list of final arguments.
 	 | el.onclick = eve.f("click", 1, 2);
 	 | eve.on("click", function (a, b, c) {
 	 |     console.log(a, b, c); // 1, 2, [event object]
 	 | });
     > Arguments
	 - event (string) event name
	 - varargs (…) and any other arguments
	 = (function) possible event handler function
    \*/
	eve.f = function (event) {
		var attrs = [].slice.call(arguments, 1);
		return function () {
			eve.apply(null, [event, null].concat(attrs).concat([].slice.call(arguments, 0)));
		};
	};
    /*\
     * eve.stop
     [ method ]
     **
     * Is used inside an event handler to stop the event, preventing any subsequent listeners from firing.
    \*/
    eve.stop = function () {
        stop = 1;
    };
    /*\
     * eve.nt
     [ method ]
     **
     * Could be used inside event handler to figure out actual name of the event.
     **
     > Arguments
     **
     - subname (string) #optional subname of the event
     **
     = (string) name of the event, if `subname` is not specified
     * or
     = (boolean) `true`, if current event’s name contains `subname`
    \*/
    eve.nt = function (subname) {
        if (subname) {
            return new RegExp("(?:\\.|\\/|^)" + subname + "(?:\\.|\\/|$)").test(current_event);
        }
        return current_event;
    };
    /*\
     * eve.nts
     [ method ]
     **
     * Could be used inside event handler to figure out actual name of the event.
     **
     **
     = (array) names of the event
    \*/
    eve.nts = function () {
        return current_event.split(separator);
    };
    /*\
     * eve.off
     [ method ]
     **
     * Removes given function from the list of event listeners assigned to given name.
	 * If no arguments specified all the events will be cleared.
     **
     > Arguments
     **
     - name (string) name of the event, dot (`.`) or slash (`/`) separated, with optional wildcards
     - f (function) event handler function
    \*/
    /*\
     * eve.unbind
     [ method ]
     **
     * See @eve.off
    \*/
    eve.off = eve.unbind = function (name, f) {
		if (!name) {
		    eve._events = events = {n: {}};
			return;
		}
        var names = name.split(separator),
            e,
            key,
            splice,
            i, ii, j, jj,
            cur = [events];
        for (i = 0, ii = names.length; i < ii; i++) {
            for (j = 0; j < cur.length; j += splice.length - 2) {
                splice = [j, 1];
                e = cur[j].n;
                if (names[i] != wildcard) {
                    if (e[names[i]]) {
                        splice.push(e[names[i]]);
                    }
                } else {
                    for (key in e) if (e[has](key)) {
                        splice.push(e[key]);
                    }
                }
                cur.splice.apply(cur, splice);
            }
        }
        for (i = 0, ii = cur.length; i < ii; i++) {
            e = cur[i];
            while (e.n) {
                if (f) {
                    if (e.f) {
                        for (j = 0, jj = e.f.length; j < jj; j++) if (e.f[j] == f) {
                            e.f.splice(j, 1);
                            break;
                        }
                        !e.f.length && delete e.f;
                    }
                    for (key in e.n) if (e.n[has](key) && e.n[key].f) {
                        var funcs = e.n[key].f;
                        for (j = 0, jj = funcs.length; j < jj; j++) if (funcs[j] == f) {
                            funcs.splice(j, 1);
                            break;
                        }
                        !funcs.length && delete e.n[key].f;
                    }
                } else {
                    delete e.f;
                    for (key in e.n) if (e.n[has](key) && e.n[key].f) {
                        delete e.n[key].f;
                    }
                }
                e = e.n;
            }
        }
    };
    /*\
     * eve.once
     [ method ]
     **
     * Binds given event handler with a given name to only run once then unbind itself.
     | eve.once("login", f);
     | eve("login"); // triggers f
     | eve("login"); // no listeners
     * Use @eve to trigger the listener.
     **
     > Arguments
     **
     - name (string) name of the event, dot (`.`) or slash (`/`) separated, with optional wildcards
     - f (function) event handler function
     **
     = (function) same return function as @eve.on
    \*/
    eve.once = function (name, f) {
        var f2 = function () {
            eve.unbind(name, f2);
            return f.apply(this, arguments);
        };
        return eve.on(name, f2);
    };
    /*\
     * eve.version
     [ property (string) ]
     **
     * Current version of the library.
    \*/
    eve.version = version;
    eve.toString = function () {
        return "You are running Eve " + version;
    };
    (typeof module != "undefined" && module.exports) ? (module.exports = eve) : (typeof define != "undefined" ? (define("eve", [], function() { return eve; })) : (glob.eve = eve));
})(this);
// ┌─────────────────────────────────────────────────────────────────────┐ \\
// │ "Raphaël 2.1.0" - JavaScript Vector Library                         │ \\
// ├─────────────────────────────────────────────────────────────────────┤ \\
// │ Copyright (c) 2008-2011 Dmitry Baranovskiy (http://raphaeljs.com)   │ \\
// │ Copyright (c) 2008-2011 Sencha Labs (http://sencha.com)             │ \\
// │ Licensed under the MIT (http://raphaeljs.com/license.html) license. │ \\
// └─────────────────────────────────────────────────────────────────────┘ \\

(function (glob, factory) {
    // AMD support
    if (typeof define === "function" && define.amd) {
        // Define as an anonymous module
        define('raphael',["eve"], function( eve ) {
            return factory(glob, eve);
        });
    } else {
        // Browser globals (glob is window)
        // Raphael adds itself to window
        factory(glob, glob.eve);
    }
}(this, function (window, eve) {
    /*\
     * Raphael
     [ method ]
     **
     * Creates a canvas object on which to draw.
     * You must do this first, as all future calls to drawing methods
     * from this instance will be bound to this canvas.
     > Parameters
     **
     - container (HTMLElement|string) DOM element or its ID which is going to be a parent for drawing surface
     - width (number)
     - height (number)
     - callback (function) #optional callback function which is going to be executed in the context of newly created paper
     * or
     - x (number)
     - y (number)
     - width (number)
     - height (number)
     - callback (function) #optional callback function which is going to be executed in the context of newly created paper
     * or
     - all (array) (first 3 or 4 elements in the array are equal to [containerID, width, height] or [x, y, width, height]. The rest are element descriptions in format {type: type, <attributes>}). See @Paper.add.
     - callback (function) #optional callback function which is going to be executed in the context of newly created paper
     * or
     - onReadyCallback (function) function that is going to be called on DOM ready event. You can also subscribe to this event via Eve’s “DOMLoad” event. In this case method returns `undefined`.
     = (object) @Paper
     > Usage
     | // Each of the following examples create a canvas
     | // that is 320px wide by 200px high.
     | // Canvas is created at the viewport’s 10,50 coordinate.
     | var paper = Raphael(10, 50, 320, 200);
     | // Canvas is created at the top left corner of the #notepad element
     | // (or its top right corner in dir="rtl" elements)
     | var paper = Raphael(document.getElementById("notepad"), 320, 200);
     | // Same as above
     | var paper = Raphael("notepad", 320, 200);
     | // Image dump
     | var set = Raphael(["notepad", 320, 200, {
     |     type: "rect",
     |     x: 10,
     |     y: 10,
     |     width: 25,
     |     height: 25,
     |     stroke: "#f00"
     | }, {
     |     type: "text",
     |     x: 30,
     |     y: 40,
     |     text: "Dump"
     | }]);
    \*/
    function R(first) {
        if (R.is(first, "function")) {
            return loaded ? first() : eve.on("raphael.DOMload", first);
        } else if (R.is(first, array)) {
            return R._engine.create[apply](R, first.splice(0, 3 + R.is(first[0], nu))).add(first);
        } else {
            var args = Array.prototype.slice.call(arguments, 0);
            if (R.is(args[args.length - 1], "function")) {
                var f = args.pop();
                return loaded ? f.call(R._engine.create[apply](R, args)) : eve.on("raphael.DOMload", function () {
                    f.call(R._engine.create[apply](R, args));
                });
            } else {
                return R._engine.create[apply](R, arguments);
            }
        }
    }
    R.version = "2.1.0";
    R.eve = eve;
    var loaded,
        separator = /[, ]+/,
        elements = {circle: 1, rect: 1, path: 1, ellipse: 1, text: 1, image: 1},
        formatrg = /\{(\d+)\}/g,
        proto = "prototype",
        has = "hasOwnProperty",
        g = {
            doc: document,
            win: window
        },
        oldRaphael = {
            was: Object.prototype[has].call(g.win, "Raphael"),
            is: g.win.Raphael
        },
        Paper = function () {
            /*\
             * Paper.ca
             [ property (object) ]
             **
             * Shortcut for @Paper.customAttributes
            \*/
            /*\
             * Paper.customAttributes
             [ property (object) ]
             **
             * If you have a set of attributes that you would like to represent
             * as a function of some number you can do it easily with custom attributes:
             > Usage
             | paper.customAttributes.hue = function (num) {
             |     num = num % 1;
             |     return {fill: "hsb(" + num + ", 0.75, 1)"};
             | };
             | // Custom attribute “hue” will change fill
             | // to be given hue with fixed saturation and brightness.
             | // Now you can use it like this:
             | var c = paper.circle(10, 10, 10).attr({hue: .45});
             | // or even like this:
             | c.animate({hue: 1}, 1e3);
             | 
             | // You could also create custom attribute
             | // with multiple parameters:
             | paper.customAttributes.hsb = function (h, s, b) {
             |     return {fill: "hsb(" + [h, s, b].join(",") + ")"};
             | };
             | c.attr({hsb: "0.5 .8 1"});
             | c.animate({hsb: [1, 0, 0.5]}, 1e3);
            \*/
            this.ca = this.customAttributes = {};
        },
        paperproto,
        appendChild = "appendChild",
        apply = "apply",
        concat = "concat",
        supportsTouch = ('ontouchstart' in g.win) || g.win.DocumentTouch && g.doc instanceof DocumentTouch, //taken from Modernizr touch test
        E = "",
        S = " ",
        Str = String,
        split = "split",
        events = "click dblclick mousedown mousemove mouseout mouseover mouseup touchstart touchmove touchend touchcancel"[split](S),
        touchMap = {
            mousedown: "touchstart",
            mousemove: "touchmove",
            mouseup: "touchend"
        },
        lowerCase = Str.prototype.toLowerCase,
        math = Math,
        mmax = math.max,
        mmin = math.min,
        abs = math.abs,
        pow = math.pow,
        PI = math.PI,
        nu = "number",
        string = "string",
        array = "array",
        toString = "toString",
        fillString = "fill",
        objectToString = Object.prototype.toString,
        paper = {},
        push = "push",
        ISURL = R._ISURL = /^url\(['"]?([^\)]+?)['"]?\)$/i,
        colourRegExp = /^\s*((#[a-f\d]{6})|(#[a-f\d]{3})|rgba?\(\s*([\d\.]+%?\s*,\s*[\d\.]+%?\s*,\s*[\d\.]+%?(?:\s*,\s*[\d\.]+%?)?)\s*\)|hsba?\(\s*([\d\.]+(?:deg|\xb0|%)?\s*,\s*[\d\.]+%?\s*,\s*[\d\.]+(?:%?\s*,\s*[\d\.]+)?)%?\s*\)|hsla?\(\s*([\d\.]+(?:deg|\xb0|%)?\s*,\s*[\d\.]+%?\s*,\s*[\d\.]+(?:%?\s*,\s*[\d\.]+)?)%?\s*\))\s*$/i,
        isnan = {"NaN": 1, "Infinity": 1, "-Infinity": 1},
        bezierrg = /^(?:cubic-)?bezier\(([^,]+),([^,]+),([^,]+),([^\)]+)\)/,
        round = math.round,
        setAttribute = "setAttribute",
        toFloat = parseFloat,
        toInt = parseInt,
        upperCase = Str.prototype.toUpperCase,
        availableAttrs = R._availableAttrs = {
            "arrow-end": "none",
            "arrow-start": "none",
            blur: 0,
            "clip-rect": "0 0 1e9 1e9",
            cursor: "default",
            cx: 0,
            cy: 0,
            fill: "#fff",
            "fill-opacity": 1,
            font: '10px "Arial"',
            "font-family": '"Arial"',
            "font-size": "10",
            "font-style": "normal",
            "font-weight": 400,
            gradient: 0,
            height: 0,
            href: "http://raphaeljs.com/",
            "letter-spacing": 0,
            opacity: 1,
            path: "M0,0",
            r: 0,
            rx: 0,
            ry: 0,
            src: "",
            stroke: "#000",
            "stroke-dasharray": "",
            "stroke-linecap": "butt",
            "stroke-linejoin": "butt",
            "stroke-miterlimit": 0,
            "stroke-opacity": 1,
            "stroke-width": 1,
            target: "_blank",
            "text-anchor": "middle",
            title: "Raphael",
            transform: "",
            width: 0,
            x: 0,
            y: 0
        },
        availableAnimAttrs = R._availableAnimAttrs = {
            blur: nu,
            "clip-rect": "csv",
            cx: nu,
            cy: nu,
            fill: "colour",
            "fill-opacity": nu,
            "font-size": nu,
            height: nu,
            opacity: nu,
            path: "path",
            r: nu,
            rx: nu,
            ry: nu,
            stroke: "colour",
            "stroke-opacity": nu,
            "stroke-width": nu,
            transform: "transform",
            width: nu,
            x: nu,
            y: nu
        },
        whitespace = /[\x09\x0a\x0b\x0c\x0d\x20\xa0\u1680\u180e\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u202f\u205f\u3000\u2028\u2029]/g,
        commaSpaces = /[\x09\x0a\x0b\x0c\x0d\x20\xa0\u1680\u180e\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u202f\u205f\u3000\u2028\u2029]*,[\x09\x0a\x0b\x0c\x0d\x20\xa0\u1680\u180e\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u202f\u205f\u3000\u2028\u2029]*/,
        hsrg = {hs: 1, rg: 1},
        p2s = /,?([achlmqrstvxz]),?/gi,
        pathCommand = /([achlmrqstvz])[\x09\x0a\x0b\x0c\x0d\x20\xa0\u1680\u180e\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u202f\u205f\u3000\u2028\u2029,]*((-?\d*\.?\d*(?:e[\-+]?\d+)?[\x09\x0a\x0b\x0c\x0d\x20\xa0\u1680\u180e\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u202f\u205f\u3000\u2028\u2029]*,?[\x09\x0a\x0b\x0c\x0d\x20\xa0\u1680\u180e\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u202f\u205f\u3000\u2028\u2029]*)+)/ig,
        tCommand = /([rstm])[\x09\x0a\x0b\x0c\x0d\x20\xa0\u1680\u180e\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u202f\u205f\u3000\u2028\u2029,]*((-?\d*\.?\d*(?:e[\-+]?\d+)?[\x09\x0a\x0b\x0c\x0d\x20\xa0\u1680\u180e\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u202f\u205f\u3000\u2028\u2029]*,?[\x09\x0a\x0b\x0c\x0d\x20\xa0\u1680\u180e\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u202f\u205f\u3000\u2028\u2029]*)+)/ig,
        pathValues = /(-?\d*\.?\d*(?:e[\-+]?\d+)?)[\x09\x0a\x0b\x0c\x0d\x20\xa0\u1680\u180e\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u202f\u205f\u3000\u2028\u2029]*,?[\x09\x0a\x0b\x0c\x0d\x20\xa0\u1680\u180e\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u202f\u205f\u3000\u2028\u2029]*/ig,
        radial_gradient = R._radial_gradient = /^r(?:\(([^,]+?)[\x09\x0a\x0b\x0c\x0d\x20\xa0\u1680\u180e\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u202f\u205f\u3000\u2028\u2029]*,[\x09\x0a\x0b\x0c\x0d\x20\xa0\u1680\u180e\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u202f\u205f\u3000\u2028\u2029]*([^\)]+?)\))?/,
        eldata = {},
        sortByKey = function (a, b) {
            return a.key - b.key;
        },
        sortByNumber = function (a, b) {
            return toFloat(a) - toFloat(b);
        },
        fun = function () {},
        pipe = function (x) {
            return x;
        },
        rectPath = R._rectPath = function (x, y, w, h, r) {
            if (r) {
                return [["M", x + r, y], ["l", w - r * 2, 0], ["a", r, r, 0, 0, 1, r, r], ["l", 0, h - r * 2], ["a", r, r, 0, 0, 1, -r, r], ["l", r * 2 - w, 0], ["a", r, r, 0, 0, 1, -r, -r], ["l", 0, r * 2 - h], ["a", r, r, 0, 0, 1, r, -r], ["z"]];
            }
            return [["M", x, y], ["l", w, 0], ["l", 0, h], ["l", -w, 0], ["z"]];
        },
        ellipsePath = function (x, y, rx, ry) {
            if (ry == null) {
                ry = rx;
            }
            return [["M", x, y], ["m", 0, -ry], ["a", rx, ry, 0, 1, 1, 0, 2 * ry], ["a", rx, ry, 0, 1, 1, 0, -2 * ry], ["z"]];
        },
        getPath = R._getPath = {
            path: function (el) {
                return el.attr("path");
            },
            circle: function (el) {
                var a = el.attrs;
                return ellipsePath(a.cx, a.cy, a.r);
            },
            ellipse: function (el) {
                var a = el.attrs;
                return ellipsePath(a.cx, a.cy, a.rx, a.ry);
            },
            rect: function (el) {
                var a = el.attrs;
                return rectPath(a.x, a.y, a.width, a.height, a.r);
            },
            image: function (el) {
                var a = el.attrs;
                return rectPath(a.x, a.y, a.width, a.height);
            },
            text: function (el) {
                var bbox = el._getBBox();
                return rectPath(bbox.x, bbox.y, bbox.width, bbox.height);
            },
            set : function(el) {
                var bbox = el._getBBox();
                return rectPath(bbox.x, bbox.y, bbox.width, bbox.height);
            }
        },
        /*\
         * Raphael.mapPath
         [ method ]
         **
         * Transform the path string with given matrix.
         > Parameters
         - path (string) path string
         - matrix (object) see @Matrix
         = (string) transformed path string
        \*/
        mapPath = R.mapPath = function (path, matrix) {
            if (!matrix) {
                return path;
            }
            var x, y, i, j, ii, jj, pathi;
            path = path2curve(path);
            for (i = 0, ii = path.length; i < ii; i++) {
                pathi = path[i];
                for (j = 1, jj = pathi.length; j < jj; j += 2) {
                    x = matrix.x(pathi[j], pathi[j + 1]);
                    y = matrix.y(pathi[j], pathi[j + 1]);
                    pathi[j] = x;
                    pathi[j + 1] = y;
                }
            }
            return path;
        };

    R._g = g;
    /*\
     * Raphael.type
     [ property (string) ]
     **
     * Can be “SVG”, “VML” or empty, depending on browser support.
    \*/
    R.type = (g.win.SVGAngle || g.doc.implementation.hasFeature("http://www.w3.org/TR/SVG11/feature#BasicStructure", "1.1") ? "SVG" : "VML");
    if (R.type == "VML") {
        var d = g.doc.createElement("div"),
            b;
        d.innerHTML = '<v:shape adj="1"/>';
        b = d.firstChild;
        b.style.behavior = "url(#default#VML)";
        if (!(b && typeof b.adj == "object")) {
            return (R.type = E);
        }
        d = null;
    }
    /*\
     * Raphael.svg
     [ property (boolean) ]
     **
     * `true` if browser supports SVG.
    \*/
    /*\
     * Raphael.vml
     [ property (boolean) ]
     **
     * `true` if browser supports VML.
    \*/
    R.svg = !(R.vml = R.type == "VML");
    R._Paper = Paper;
    /*\
     * Raphael.fn
     [ property (object) ]
     **
     * You can add your own method to the canvas. For example if you want to draw a pie chart,
     * you can create your own pie chart function and ship it as a Raphaël plugin. To do this
     * you need to extend the `Raphael.fn` object. You should modify the `fn` object before a
     * Raphaël instance is created, otherwise it will take no effect. Please note that the
     * ability for namespaced plugins was removed in Raphael 2.0. It is up to the plugin to
     * ensure any namespacing ensures proper context.
     > Usage
     | Raphael.fn.arrow = function (x1, y1, x2, y2, size) {
     |     return this.path( ... );
     | };
     | // or create namespace
     | Raphael.fn.mystuff = {
     |     arrow: function () {…},
     |     star: function () {…},
     |     // etc…
     | };
     | var paper = Raphael(10, 10, 630, 480);
     | // then use it
     | paper.arrow(10, 10, 30, 30, 5).attr({fill: "#f00"});
     | paper.mystuff.arrow();
     | paper.mystuff.star();
    \*/
    R.fn = paperproto = Paper.prototype = R.prototype;
    R._id = 0;
    R._oid = 0;
    /*\
     * Raphael.is
     [ method ]
     **
     * Handfull replacement for `typeof` operator.
     > Parameters
     - o (…) any object or primitive
     - type (string) name of the type, i.e. “string”, “function”, “number”, etc.
     = (boolean) is given value is of given type
    \*/
    R.is = function (o, type) {
        type = lowerCase.call(type);
        if (type == "finite") {
            return !isnan[has](+o);
        }
        if (type == "array") {
            return o instanceof Array;
        }
        return  (type == "null" && o === null) ||
                (type == typeof o && o !== null) ||
                (type == "object" && o === Object(o)) ||
                (type == "array" && Array.isArray && Array.isArray(o)) ||
                objectToString.call(o).slice(8, -1).toLowerCase() == type;
    };

    function clone(obj) {
        if (typeof obj == "function" || Object(obj) !== obj) {
            return obj;
        }
        var res = new obj.constructor;
        for (var key in obj) if (obj[has](key)) {
            res[key] = clone(obj[key]);
        }
        return res;
    }

    /*\
     * Raphael.angle
     [ method ]
     **
     * Returns angle between two or three points
     > Parameters
     - x1 (number) x coord of first point
     - y1 (number) y coord of first point
     - x2 (number) x coord of second point
     - y2 (number) y coord of second point
     - x3 (number) #optional x coord of third point
     - y3 (number) #optional y coord of third point
     = (number) angle in degrees.
    \*/
    R.angle = function (x1, y1, x2, y2, x3, y3) {
        if (x3 == null) {
            var x = x1 - x2,
                y = y1 - y2;
            if (!x && !y) {
                return 0;
            }
            return (180 + math.atan2(-y, -x) * 180 / PI + 360) % 360;
        } else {
            return R.angle(x1, y1, x3, y3) - R.angle(x2, y2, x3, y3);
        }
    };
    /*\
     * Raphael.rad
     [ method ]
     **
     * Transform angle to radians
     > Parameters
     - deg (number) angle in degrees
     = (number) angle in radians.
    \*/
    R.rad = function (deg) {
        return deg % 360 * PI / 180;
    };
    /*\
     * Raphael.deg
     [ method ]
     **
     * Transform angle to degrees
     > Parameters
     - deg (number) angle in radians
     = (number) angle in degrees.
    \*/
    R.deg = function (rad) {
        return rad * 180 / PI % 360;
    };
    /*\
     * Raphael.snapTo
     [ method ]
     **
     * Snaps given value to given grid.
     > Parameters
     - values (array|number) given array of values or step of the grid
     - value (number) value to adjust
     - tolerance (number) #optional tolerance for snapping. Default is `10`.
     = (number) adjusted value.
    \*/
    R.snapTo = function (values, value, tolerance) {
        tolerance = R.is(tolerance, "finite") ? tolerance : 10;
        if (R.is(values, array)) {
            var i = values.length;
            while (i--) if (abs(values[i] - value) <= tolerance) {
                return values[i];
            }
        } else {
            values = +values;
            var rem = value % values;
            if (rem < tolerance) {
                return value - rem;
            }
            if (rem > values - tolerance) {
                return value - rem + values;
            }
        }
        return value;
    };

    /*\
     * Raphael.createUUID
     [ method ]
     **
     * Returns RFC4122, version 4 ID
    \*/
    var createUUID = R.createUUID = (function (uuidRegEx, uuidReplacer) {
        return function () {
            return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(uuidRegEx, uuidReplacer).toUpperCase();
        };
    })(/[xy]/g, function (c) {
        var r = math.random() * 16 | 0,
            v = c == "x" ? r : (r & 3 | 8);
        return v.toString(16);
    });

    /*\
     * Raphael.setWindow
     [ method ]
     **
     * Used when you need to draw in `&lt;iframe>`. Switched window to the iframe one.
     > Parameters
     - newwin (window) new window object
    \*/
    R.setWindow = function (newwin) {
        eve("raphael.setWindow", R, g.win, newwin);
        g.win = newwin;
        g.doc = g.win.document;
        if (R._engine.initWin) {
            R._engine.initWin(g.win);
        }
    };
    var toHex = function (color) {
        if (R.vml) {
            // http://dean.edwards.name/weblog/2009/10/convert-any-colour-value-to-hex-in-msie/
            var trim = /^\s+|\s+$/g;
            var bod;
            try {
                var docum = new ActiveXObject("htmlfile");
                docum.write("<body>");
                docum.close();
                bod = docum.body;
            } catch(e) {
                bod = createPopup().document.body;
            }
            var range = bod.createTextRange();
            toHex = cacher(function (color) {
                try {
                    bod.style.color = Str(color).replace(trim, E);
                    var value = range.queryCommandValue("ForeColor");
                    value = ((value & 255) << 16) | (value & 65280) | ((value & 16711680) >>> 16);
                    return "#" + ("000000" + value.toString(16)).slice(-6);
                } catch(e) {
                    return "none";
                }
            });
        } else {
            var i = g.doc.createElement("i");
            i.title = "Rapha\xebl Colour Picker";
            i.style.display = "none";
            g.doc.body.appendChild(i);
            toHex = cacher(function (color) {
                i.style.color = color;
                return g.doc.defaultView.getComputedStyle(i, E).getPropertyValue("color");
            });
        }
        return toHex(color);
    },
    hsbtoString = function () {
        return "hsb(" + [this.h, this.s, this.b] + ")";
    },
    hsltoString = function () {
        return "hsl(" + [this.h, this.s, this.l] + ")";
    },
    rgbtoString = function () {
        return this.hex;
    },
    prepareRGB = function (r, g, b) {
        if (g == null && R.is(r, "object") && "r" in r && "g" in r && "b" in r) {
            b = r.b;
            g = r.g;
            r = r.r;
        }
        if (g == null && R.is(r, string)) {
            var clr = R.getRGB(r);
            r = clr.r;
            g = clr.g;
            b = clr.b;
        }
        if (r > 1 || g > 1 || b > 1) {
            r /= 255;
            g /= 255;
            b /= 255;
        }

        return [r, g, b];
    },
    packageRGB = function (r, g, b, o) {
        r *= 255;
        g *= 255;
        b *= 255;
        var rgb = {
            r: r,
            g: g,
            b: b,
            hex: R.rgb(r, g, b),
            toString: rgbtoString
        };
        R.is(o, "finite") && (rgb.opacity = o);
        return rgb;
    };

    /*\
     * Raphael.color
     [ method ]
     **
     * Parses the color string and returns object with all values for the given color.
     > Parameters
     - clr (string) color string in one of the supported formats (see @Raphael.getRGB)
     = (object) Combined RGB & HSB object in format:
     o {
     o     r (number) red,
     o     g (number) green,
     o     b (number) blue,
     o     hex (string) color in HTML/CSS format: #••••••,
     o     error (boolean) `true` if string can’t be parsed,
     o     h (number) hue,
     o     s (number) saturation,
     o     v (number) value (brightness),
     o     l (number) lightness
     o }
    \*/
    R.color = function (clr) {
        var rgb;
        if (R.is(clr, "object") && "h" in clr && "s" in clr && "b" in clr) {
            rgb = R.hsb2rgb(clr);
            clr.r = rgb.r;
            clr.g = rgb.g;
            clr.b = rgb.b;
            clr.hex = rgb.hex;
        } else if (R.is(clr, "object") && "h" in clr && "s" in clr && "l" in clr) {
            rgb = R.hsl2rgb(clr);
            clr.r = rgb.r;
            clr.g = rgb.g;
            clr.b = rgb.b;
            clr.hex = rgb.hex;
        } else {
            if (R.is(clr, "string")) {
                clr = R.getRGB(clr);
            }
            if (R.is(clr, "object") && "r" in clr && "g" in clr && "b" in clr) {
                rgb = R.rgb2hsl(clr);
                clr.h = rgb.h;
                clr.s = rgb.s;
                clr.l = rgb.l;
                rgb = R.rgb2hsb(clr);
                clr.v = rgb.b;
            } else {
                clr = {hex: "none"};
                clr.r = clr.g = clr.b = clr.h = clr.s = clr.v = clr.l = -1;
            }
        }
        clr.toString = rgbtoString;
        return clr;
    };
    /*\
     * Raphael.hsb2rgb
     [ method ]
     **
     * Converts HSB values to RGB object.
     > Parameters
     - h (number) hue
     - s (number) saturation
     - v (number) value or brightness
     = (object) RGB object in format:
     o {
     o     r (number) red,
     o     g (number) green,
     o     b (number) blue,
     o     hex (string) color in HTML/CSS format: #••••••
     o }
    \*/
    R.hsb2rgb = function (h, s, v, o) {
        if (this.is(h, "object") && "h" in h && "s" in h && "b" in h) {
            v = h.b;
            s = h.s;
            h = h.h;
            o = h.o;
        }
        h *= 360;
        var R, G, B, X, C;
        h = (h % 360) / 60;
        C = v * s;
        X = C * (1 - abs(h % 2 - 1));
        R = G = B = v - C;

        h = ~~h;
        R += [C, X, 0, 0, X, C][h];
        G += [X, C, C, X, 0, 0][h];
        B += [0, 0, X, C, C, X][h];
        return packageRGB(R, G, B, o);
    };
    /*\
     * Raphael.hsl2rgb
     [ method ]
     **
     * Converts HSL values to RGB object.
     > Parameters
     - h (number) hue
     - s (number) saturation
     - l (number) luminosity
     = (object) RGB object in format:
     o {
     o     r (number) red,
     o     g (number) green,
     o     b (number) blue,
     o     hex (string) color in HTML/CSS format: #••••••
     o }
    \*/
    R.hsl2rgb = function (h, s, l, o) {
        if (this.is(h, "object") && "h" in h && "s" in h && "l" in h) {
            l = h.l;
            s = h.s;
            h = h.h;
        }
        if (h > 1 || s > 1 || l > 1) {
            h /= 360;
            s /= 100;
            l /= 100;
        }
        h *= 360;
        var R, G, B, X, C;
        h = (h % 360) / 60;
        C = 2 * s * (l < .5 ? l : 1 - l);
        X = C * (1 - abs(h % 2 - 1));
        R = G = B = l - C / 2;

        h = ~~h;
        R += [C, X, 0, 0, X, C][h];
        G += [X, C, C, X, 0, 0][h];
        B += [0, 0, X, C, C, X][h];
        return packageRGB(R, G, B, o);
    };
    /*\
     * Raphael.rgb2hsb
     [ method ]
     **
     * Converts RGB values to HSB object.
     > Parameters
     - r (number) red
     - g (number) green
     - b (number) blue
     = (object) HSB object in format:
     o {
     o     h (number) hue
     o     s (number) saturation
     o     b (number) brightness
     o }
    \*/
    R.rgb2hsb = function (r, g, b) {
        b = prepareRGB(r, g, b);
        r = b[0];
        g = b[1];
        b = b[2];

        var H, S, V, C;
        V = mmax(r, g, b);
        C = V - mmin(r, g, b);
        H = (C == 0 ? null :
             V == r ? (g - b) / C :
             V == g ? (b - r) / C + 2 :
                      (r - g) / C + 4
            );
        H = ((H + 360) % 6) * 60 / 360;
        S = C == 0 ? 0 : C / V;
        return {h: H, s: S, b: V, toString: hsbtoString};
    };
    /*\
     * Raphael.rgb2hsl
     [ method ]
     **
     * Converts RGB values to HSL object.
     > Parameters
     - r (number) red
     - g (number) green
     - b (number) blue
     = (object) HSL object in format:
     o {
     o     h (number) hue
     o     s (number) saturation
     o     l (number) luminosity
     o }
    \*/
    R.rgb2hsl = function (r, g, b) {
        b = prepareRGB(r, g, b);
        r = b[0];
        g = b[1];
        b = b[2];

        var H, S, L, M, m, C;
        M = mmax(r, g, b);
        m = mmin(r, g, b);
        C = M - m;
        H = (C == 0 ? null :
             M == r ? (g - b) / C :
             M == g ? (b - r) / C + 2 :
                      (r - g) / C + 4);
        H = ((H + 360) % 6) * 60 / 360;
        L = (M + m) / 2;
        S = (C == 0 ? 0 :
             L < .5 ? C / (2 * L) :
                      C / (2 - 2 * L));
        return {h: H, s: S, l: L, toString: hsltoString};
    };
    R._path2string = function () {
        return this.join(",").replace(p2s, "$1");
    };
    function repush(array, item) {
        for (var i = 0, ii = array.length; i < ii; i++) if (array[i] === item) {
            return array.push(array.splice(i, 1)[0]);
        }
    }
    function cacher(f, scope, postprocessor) {
        function newf() {
            var arg = Array.prototype.slice.call(arguments, 0),
                args = arg.join("\u2400"),
                cache = newf.cache = newf.cache || {},
                count = newf.count = newf.count || [];
            if (cache[has](args)) {
                repush(count, args);
                return postprocessor ? postprocessor(cache[args]) : cache[args];
            }
            count.length >= 1e3 && delete cache[count.shift()];
            count.push(args);
            cache[args] = f[apply](scope, arg);
            return postprocessor ? postprocessor(cache[args]) : cache[args];
        }
        return newf;
    }

    var preload = R._preload = function (src, f) {
        var img = g.doc.createElement("img");
        img.style.cssText = "position:absolute;left:-9999em;top:-9999em";
        img.onload = function () {
            f.call(this);
            this.onload = null;
            g.doc.body.removeChild(this);
        };
        img.onerror = function () {
            g.doc.body.removeChild(this);
        };
        g.doc.body.appendChild(img);
        img.src = src;
    };

    function clrToString() {
        return this.hex;
    }

    /*\
     * Raphael.getRGB
     [ method ]
     **
     * Parses colour string as RGB object
     > Parameters
     - colour (string) colour string in one of formats:
     # <ul>
     #     <li>Colour name (“<code>red</code>”, “<code>green</code>”, “<code>cornflowerblue</code>”, etc)</li>
     #     <li>#••• — shortened HTML colour: (“<code>#000</code>”, “<code>#fc0</code>”, etc)</li>
     #     <li>#•••••• — full length HTML colour: (“<code>#000000</code>”, “<code>#bd2300</code>”)</li>
     #     <li>rgb(•••, •••, •••) — red, green and blue channels’ values: (“<code>rgb(200,&nbsp;100,&nbsp;0)</code>”)</li>
     #     <li>rgb(•••%, •••%, •••%) — same as above, but in %: (“<code>rgb(100%,&nbsp;175%,&nbsp;0%)</code>”)</li>
     #     <li>hsb(•••, •••, •••) — hue, saturation and brightness values: (“<code>hsb(0.5,&nbsp;0.25,&nbsp;1)</code>”)</li>
     #     <li>hsb(•••%, •••%, •••%) — same as above, but in %</li>
     #     <li>hsl(•••, •••, •••) — same as hsb</li>
     #     <li>hsl(•••%, •••%, •••%) — same as hsb</li>
     # </ul>
     = (object) RGB object in format:
     o {
     o     r (number) red,
     o     g (number) green,
     o     b (number) blue
     o     hex (string) color in HTML/CSS format: #••••••,
     o     error (boolean) true if string can’t be parsed
     o }
    \*/
    R.getRGB = cacher(function (colour) {
        if (!colour || !!((colour = Str(colour)).indexOf("-") + 1)) {
            return {r: -1, g: -1, b: -1, hex: "none", error: 1, toString: clrToString};
        }
        if (colour == "none") {
            return {r: -1, g: -1, b: -1, hex: "none", toString: clrToString};
        }
        !(hsrg[has](colour.toLowerCase().substring(0, 2)) || colour.charAt() == "#") && (colour = toHex(colour));
        var res,
            red,
            green,
            blue,
            opacity,
            t,
            values,
            rgb = colour.match(colourRegExp);
        if (rgb) {
            if (rgb[2]) {
                blue = toInt(rgb[2].substring(5), 16);
                green = toInt(rgb[2].substring(3, 5), 16);
                red = toInt(rgb[2].substring(1, 3), 16);
            }
            if (rgb[3]) {
                blue = toInt((t = rgb[3].charAt(3)) + t, 16);
                green = toInt((t = rgb[3].charAt(2)) + t, 16);
                red = toInt((t = rgb[3].charAt(1)) + t, 16);
            }
            if (rgb[4]) {
                values = rgb[4][split](commaSpaces);
                red = toFloat(values[0]);
                values[0].slice(-1) == "%" && (red *= 2.55);
                green = toFloat(values[1]);
                values[1].slice(-1) == "%" && (green *= 2.55);
                blue = toFloat(values[2]);
                values[2].slice(-1) == "%" && (blue *= 2.55);
                rgb[1].toLowerCase().slice(0, 4) == "rgba" && (opacity = toFloat(values[3]));
                values[3] && values[3].slice(-1) == "%" && (opacity /= 100);
            }
            if (rgb[5]) {
                values = rgb[5][split](commaSpaces);
                red = toFloat(values[0]);
                values[0].slice(-1) == "%" && (red *= 2.55);
                green = toFloat(values[1]);
                values[1].slice(-1) == "%" && (green *= 2.55);
                blue = toFloat(values[2]);
                values[2].slice(-1) == "%" && (blue *= 2.55);
                (values[0].slice(-3) == "deg" || values[0].slice(-1) == "\xb0") && (red /= 360);
                rgb[1].toLowerCase().slice(0, 4) == "hsba" && (opacity = toFloat(values[3]));
                values[3] && values[3].slice(-1) == "%" && (opacity /= 100);
                return R.hsb2rgb(red, green, blue, opacity);
            }
            if (rgb[6]) {
                values = rgb[6][split](commaSpaces);
                red = toFloat(values[0]);
                values[0].slice(-1) == "%" && (red *= 2.55);
                green = toFloat(values[1]);
                values[1].slice(-1) == "%" && (green *= 2.55);
                blue = toFloat(values[2]);
                values[2].slice(-1) == "%" && (blue *= 2.55);
                (values[0].slice(-3) == "deg" || values[0].slice(-1) == "\xb0") && (red /= 360);
                rgb[1].toLowerCase().slice(0, 4) == "hsla" && (opacity = toFloat(values[3]));
                values[3] && values[3].slice(-1) == "%" && (opacity /= 100);
                return R.hsl2rgb(red, green, blue, opacity);
            }
            rgb = {r: red, g: green, b: blue, toString: clrToString};
            rgb.hex = "#" + (16777216 | blue | (green << 8) | (red << 16)).toString(16).slice(1);
            R.is(opacity, "finite") && (rgb.opacity = opacity);
            return rgb;
        }
        return {r: -1, g: -1, b: -1, hex: "none", error: 1, toString: clrToString};
    }, R);
    /*\
     * Raphael.hsb
     [ method ]
     **
     * Converts HSB values to hex representation of the colour.
     > Parameters
     - h (number) hue
     - s (number) saturation
     - b (number) value or brightness
     = (string) hex representation of the colour.
    \*/
    R.hsb = cacher(function (h, s, b) {
        return R.hsb2rgb(h, s, b).hex;
    });
    /*\
     * Raphael.hsl
     [ method ]
     **
     * Converts HSL values to hex representation of the colour.
     > Parameters
     - h (number) hue
     - s (number) saturation
     - l (number) luminosity
     = (string) hex representation of the colour.
    \*/
    R.hsl = cacher(function (h, s, l) {
        return R.hsl2rgb(h, s, l).hex;
    });
    /*\
     * Raphael.rgb
     [ method ]
     **
     * Converts RGB values to hex representation of the colour.
     > Parameters
     - r (number) red
     - g (number) green
     - b (number) blue
     = (string) hex representation of the colour.
    \*/
    R.rgb = cacher(function (r, g, b) {
        return "#" + (16777216 | b | (g << 8) | (r << 16)).toString(16).slice(1);
    });
    /*\
     * Raphael.getColor
     [ method ]
     **
     * On each call returns next colour in the spectrum. To reset it back to red call @Raphael.getColor.reset
     > Parameters
     - value (number) #optional brightness, default is `0.75`
     = (string) hex representation of the colour.
    \*/
    R.getColor = function (value) {
        var start = this.getColor.start = this.getColor.start || {h: 0, s: 1, b: value || .75},
            rgb = this.hsb2rgb(start.h, start.s, start.b);
        start.h += .075;
        if (start.h > 1) {
            start.h = 0;
            start.s -= .2;
            start.s <= 0 && (this.getColor.start = {h: 0, s: 1, b: start.b});
        }
        return rgb.hex;
    };
    /*\
     * Raphael.getColor.reset
     [ method ]
     **
     * Resets spectrum position for @Raphael.getColor back to red.
    \*/
    R.getColor.reset = function () {
        delete this.start;
    };

    // http://schepers.cc/getting-to-the-point
    function catmullRom2bezier(crp, z) {
        var d = [];
        for (var i = 0, iLen = crp.length; iLen - 2 * !z > i; i += 2) {
            var p = [
                        {x: +crp[i - 2], y: +crp[i - 1]},
                        {x: +crp[i],     y: +crp[i + 1]},
                        {x: +crp[i + 2], y: +crp[i + 3]},
                        {x: +crp[i + 4], y: +crp[i + 5]}
                    ];
            if (z) {
                if (!i) {
                    p[0] = {x: +crp[iLen - 2], y: +crp[iLen - 1]};
                } else if (iLen - 4 == i) {
                    p[3] = {x: +crp[0], y: +crp[1]};
                } else if (iLen - 2 == i) {
                    p[2] = {x: +crp[0], y: +crp[1]};
                    p[3] = {x: +crp[2], y: +crp[3]};
                }
            } else {
                if (iLen - 4 == i) {
                    p[3] = p[2];
                } else if (!i) {
                    p[0] = {x: +crp[i], y: +crp[i + 1]};
                }
            }
            d.push(["C",
                  (-p[0].x + 6 * p[1].x + p[2].x) / 6,
                  (-p[0].y + 6 * p[1].y + p[2].y) / 6,
                  (p[1].x + 6 * p[2].x - p[3].x) / 6,
                  (p[1].y + 6*p[2].y - p[3].y) / 6,
                  p[2].x,
                  p[2].y
            ]);
        }

        return d;
    }
    /*\
     * Raphael.parsePathString
     [ method ]
     **
     * Utility method
     **
     * Parses given path string into an array of arrays of path segments.
     > Parameters
     - pathString (string|array) path string or array of segments (in the last case it will be returned straight away)
     = (array) array of segments.
    \*/
    R.parsePathString = function (pathString) {
        if (!pathString) {
            return null;
        }
        var pth = paths(pathString);
        if (pth.arr) {
            return pathClone(pth.arr);
        }

        var paramCounts = {a: 7, c: 6, h: 1, l: 2, m: 2, r: 4, q: 4, s: 4, t: 2, v: 1, z: 0},
            data = [];
        if (R.is(pathString, array) && R.is(pathString[0], array)) { // rough assumption
            data = pathClone(pathString);
        }
        if (!data.length) {
            Str(pathString).replace(pathCommand, function (a, b, c) {
                var params = [],
                    name = b.toLowerCase();
                c.replace(pathValues, function (a, b) {
                    b && params.push(+b);
                });
                if (name == "m" && params.length > 2) {
                    data.push([b][concat](params.splice(0, 2)));
                    name = "l";
                    b = b == "m" ? "l" : "L";
                }
                if (name == "r") {
                    data.push([b][concat](params));
                } else while (params.length >= paramCounts[name]) {
                    data.push([b][concat](params.splice(0, paramCounts[name])));
                    if (!paramCounts[name]) {
                        break;
                    }
                }
            });
        }
        data.toString = R._path2string;
        pth.arr = pathClone(data);
        return data;
    };
    /*\
     * Raphael.parseTransformString
     [ method ]
     **
     * Utility method
     **
     * Parses given path string into an array of transformations.
     > Parameters
     - TString (string|array) transform string or array of transformations (in the last case it will be returned straight away)
     = (array) array of transformations.
    \*/
    R.parseTransformString = cacher(function (TString) {
        if (!TString) {
            return null;
        }
        var paramCounts = {r: 3, s: 4, t: 2, m: 6},
            data = [];
        if (R.is(TString, array) && R.is(TString[0], array)) { // rough assumption
            data = pathClone(TString);
        }
        if (!data.length) {
            Str(TString).replace(tCommand, function (a, b, c) {
                var params = [],
                    name = lowerCase.call(b);
                c.replace(pathValues, function (a, b) {
                    b && params.push(+b);
                });
                data.push([b][concat](params));
            });
        }
        data.toString = R._path2string;
        return data;
    });
    // PATHS
    var paths = function (ps) {
        var p = paths.ps = paths.ps || {};
        if (p[ps]) {
            p[ps].sleep = 100;
        } else {
            p[ps] = {
                sleep: 100
            };
        }
        setTimeout(function () {
            for (var key in p) if (p[has](key) && key != ps) {
                p[key].sleep--;
                !p[key].sleep && delete p[key];
            }
        });
        return p[ps];
    };
    /*\
     * Raphael.findDotsAtSegment
     [ method ]
     **
     * Utility method
     **
     * Find dot coordinates on the given cubic bezier curve at the given t.
     > Parameters
     - p1x (number) x of the first point of the curve
     - p1y (number) y of the first point of the curve
     - c1x (number) x of the first anchor of the curve
     - c1y (number) y of the first anchor of the curve
     - c2x (number) x of the second anchor of the curve
     - c2y (number) y of the second anchor of the curve
     - p2x (number) x of the second point of the curve
     - p2y (number) y of the second point of the curve
     - t (number) position on the curve (0..1)
     = (object) point information in format:
     o {
     o     x: (number) x coordinate of the point
     o     y: (number) y coordinate of the point
     o     m: {
     o         x: (number) x coordinate of the left anchor
     o         y: (number) y coordinate of the left anchor
     o     }
     o     n: {
     o         x: (number) x coordinate of the right anchor
     o         y: (number) y coordinate of the right anchor
     o     }
     o     start: {
     o         x: (number) x coordinate of the start of the curve
     o         y: (number) y coordinate of the start of the curve
     o     }
     o     end: {
     o         x: (number) x coordinate of the end of the curve
     o         y: (number) y coordinate of the end of the curve
     o     }
     o     alpha: (number) angle of the curve derivative at the point
     o }
    \*/
    R.findDotsAtSegment = function (p1x, p1y, c1x, c1y, c2x, c2y, p2x, p2y, t) {
        var t1 = 1 - t,
            t13 = pow(t1, 3),
            t12 = pow(t1, 2),
            t2 = t * t,
            t3 = t2 * t,
            x = t13 * p1x + t12 * 3 * t * c1x + t1 * 3 * t * t * c2x + t3 * p2x,
            y = t13 * p1y + t12 * 3 * t * c1y + t1 * 3 * t * t * c2y + t3 * p2y,
            mx = p1x + 2 * t * (c1x - p1x) + t2 * (c2x - 2 * c1x + p1x),
            my = p1y + 2 * t * (c1y - p1y) + t2 * (c2y - 2 * c1y + p1y),
            nx = c1x + 2 * t * (c2x - c1x) + t2 * (p2x - 2 * c2x + c1x),
            ny = c1y + 2 * t * (c2y - c1y) + t2 * (p2y - 2 * c2y + c1y),
            ax = t1 * p1x + t * c1x,
            ay = t1 * p1y + t * c1y,
            cx = t1 * c2x + t * p2x,
            cy = t1 * c2y + t * p2y,
            alpha = (90 - math.atan2(mx - nx, my - ny) * 180 / PI);
        (mx > nx || my < ny) && (alpha += 180);
        return {
            x: x,
            y: y,
            m: {x: mx, y: my},
            n: {x: nx, y: ny},
            start: {x: ax, y: ay},
            end: {x: cx, y: cy},
            alpha: alpha
        };
    };
    /*\
     * Raphael.bezierBBox
     [ method ]
     **
     * Utility method
     **
     * Return bounding box of a given cubic bezier curve
     > Parameters
     - p1x (number) x of the first point of the curve
     - p1y (number) y of the first point of the curve
     - c1x (number) x of the first anchor of the curve
     - c1y (number) y of the first anchor of the curve
     - c2x (number) x of the second anchor of the curve
     - c2y (number) y of the second anchor of the curve
     - p2x (number) x of the second point of the curve
     - p2y (number) y of the second point of the curve
     * or
     - bez (array) array of six points for bezier curve
     = (object) point information in format:
     o {
     o     min: {
     o         x: (number) x coordinate of the left point
     o         y: (number) y coordinate of the top point
     o     }
     o     max: {
     o         x: (number) x coordinate of the right point
     o         y: (number) y coordinate of the bottom point
     o     }
     o }
    \*/
    R.bezierBBox = function (p1x, p1y, c1x, c1y, c2x, c2y, p2x, p2y) {
        if (!R.is(p1x, "array")) {
            p1x = [p1x, p1y, c1x, c1y, c2x, c2y, p2x, p2y];
        }
        var bbox = curveDim.apply(null, p1x);
        return {
            x: bbox.min.x,
            y: bbox.min.y,
            x2: bbox.max.x,
            y2: bbox.max.y,
            width: bbox.max.x - bbox.min.x,
            height: bbox.max.y - bbox.min.y
        };
    };
    /*\
     * Raphael.isPointInsideBBox
     [ method ]
     **
     * Utility method
     **
     * Returns `true` if given point is inside bounding boxes.
     > Parameters
     - bbox (string) bounding box
     - x (string) x coordinate of the point
     - y (string) y coordinate of the point
     = (boolean) `true` if point inside
    \*/
    R.isPointInsideBBox = function (bbox, x, y) {
        return x >= bbox.x && x <= bbox.x2 && y >= bbox.y && y <= bbox.y2;
    };
    /*\
     * Raphael.isBBoxIntersect
     [ method ]
     **
     * Utility method
     **
     * Returns `true` if two bounding boxes intersect
     > Parameters
     - bbox1 (string) first bounding box
     - bbox2 (string) second bounding box
     = (boolean) `true` if they intersect
    \*/
    R.isBBoxIntersect = function (bbox1, bbox2) {
        var i = R.isPointInsideBBox;
        return i(bbox2, bbox1.x, bbox1.y)
            || i(bbox2, bbox1.x2, bbox1.y)
            || i(bbox2, bbox1.x, bbox1.y2)
            || i(bbox2, bbox1.x2, bbox1.y2)
            || i(bbox1, bbox2.x, bbox2.y)
            || i(bbox1, bbox2.x2, bbox2.y)
            || i(bbox1, bbox2.x, bbox2.y2)
            || i(bbox1, bbox2.x2, bbox2.y2)
            || (bbox1.x < bbox2.x2 && bbox1.x > bbox2.x || bbox2.x < bbox1.x2 && bbox2.x > bbox1.x)
            && (bbox1.y < bbox2.y2 && bbox1.y > bbox2.y || bbox2.y < bbox1.y2 && bbox2.y > bbox1.y);
    };
    function base3(t, p1, p2, p3, p4) {
        var t1 = -3 * p1 + 9 * p2 - 9 * p3 + 3 * p4,
            t2 = t * t1 + 6 * p1 - 12 * p2 + 6 * p3;
        return t * t2 - 3 * p1 + 3 * p2;
    }
    function bezlen(x1, y1, x2, y2, x3, y3, x4, y4, z) {
        if (z == null) {
            z = 1;
        }
        z = z > 1 ? 1 : z < 0 ? 0 : z;
        var z2 = z / 2,
            n = 12,
            Tvalues = [-0.1252,0.1252,-0.3678,0.3678,-0.5873,0.5873,-0.7699,0.7699,-0.9041,0.9041,-0.9816,0.9816],
            Cvalues = [0.2491,0.2491,0.2335,0.2335,0.2032,0.2032,0.1601,0.1601,0.1069,0.1069,0.0472,0.0472],
            sum = 0;
        for (var i = 0; i < n; i++) {
            var ct = z2 * Tvalues[i] + z2,
                xbase = base3(ct, x1, x2, x3, x4),
                ybase = base3(ct, y1, y2, y3, y4),
                comb = xbase * xbase + ybase * ybase;
            sum += Cvalues[i] * math.sqrt(comb);
        }
        return z2 * sum;
    }
    function getTatLen(x1, y1, x2, y2, x3, y3, x4, y4, ll) {
        if (ll < 0 || bezlen(x1, y1, x2, y2, x3, y3, x4, y4) < ll) {
            return;
        }
        var t = 1,
            step = t / 2,
            t2 = t - step,
            l,
            e = .01;
        l = bezlen(x1, y1, x2, y2, x3, y3, x4, y4, t2);
        while (abs(l - ll) > e) {
            step /= 2;
            t2 += (l < ll ? 1 : -1) * step;
            l = bezlen(x1, y1, x2, y2, x3, y3, x4, y4, t2);
        }
        return t2;
    }
    function intersect(x1, y1, x2, y2, x3, y3, x4, y4) {
        if (
            mmax(x1, x2) < mmin(x3, x4) ||
            mmin(x1, x2) > mmax(x3, x4) ||
            mmax(y1, y2) < mmin(y3, y4) ||
            mmin(y1, y2) > mmax(y3, y4)
        ) {
            return;
        }
        var nx = (x1 * y2 - y1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * y4 - y3 * x4),
            ny = (x1 * y2 - y1 * x2) * (y3 - y4) - (y1 - y2) * (x3 * y4 - y3 * x4),
            denominator = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);

        if (!denominator) {
            return;
        }
        var px = nx / denominator,
            py = ny / denominator,
            px2 = +px.toFixed(2),
            py2 = +py.toFixed(2);
        if (
            px2 < +mmin(x1, x2).toFixed(2) ||
            px2 > +mmax(x1, x2).toFixed(2) ||
            px2 < +mmin(x3, x4).toFixed(2) ||
            px2 > +mmax(x3, x4).toFixed(2) ||
            py2 < +mmin(y1, y2).toFixed(2) ||
            py2 > +mmax(y1, y2).toFixed(2) ||
            py2 < +mmin(y3, y4).toFixed(2) ||
            py2 > +mmax(y3, y4).toFixed(2)
        ) {
            return;
        }
        return {x: px, y: py};
    }
    function inter(bez1, bez2) {
        return interHelper(bez1, bez2);
    }
    function interCount(bez1, bez2) {
        return interHelper(bez1, bez2, 1);
    }
    function interHelper(bez1, bez2, justCount) {
        var bbox1 = R.bezierBBox(bez1),
            bbox2 = R.bezierBBox(bez2);
        if (!R.isBBoxIntersect(bbox1, bbox2)) {
            return justCount ? 0 : [];
        }
        var l1 = bezlen.apply(0, bez1),
            l2 = bezlen.apply(0, bez2),
            n1 = mmax(~~(l1 / 5), 1),
            n2 = mmax(~~(l2 / 5), 1),
            dots1 = [],
            dots2 = [],
            xy = {},
            res = justCount ? 0 : [];
        for (var i = 0; i < n1 + 1; i++) {
            var p = R.findDotsAtSegment.apply(R, bez1.concat(i / n1));
            dots1.push({x: p.x, y: p.y, t: i / n1});
        }
        for (i = 0; i < n2 + 1; i++) {
            p = R.findDotsAtSegment.apply(R, bez2.concat(i / n2));
            dots2.push({x: p.x, y: p.y, t: i / n2});
        }
        for (i = 0; i < n1; i++) {
            for (var j = 0; j < n2; j++) {
                var di = dots1[i],
                    di1 = dots1[i + 1],
                    dj = dots2[j],
                    dj1 = dots2[j + 1],
                    ci = abs(di1.x - di.x) < .001 ? "y" : "x",
                    cj = abs(dj1.x - dj.x) < .001 ? "y" : "x",
                    is = intersect(di.x, di.y, di1.x, di1.y, dj.x, dj.y, dj1.x, dj1.y);
                if (is) {
                    if (xy[is.x.toFixed(4)] == is.y.toFixed(4)) {
                        continue;
                    }
                    xy[is.x.toFixed(4)] = is.y.toFixed(4);
                    var t1 = di.t + abs((is[ci] - di[ci]) / (di1[ci] - di[ci])) * (di1.t - di.t),
                        t2 = dj.t + abs((is[cj] - dj[cj]) / (dj1[cj] - dj[cj])) * (dj1.t - dj.t);
                    if (t1 >= 0 && t1 <= 1.001 && t2 >= 0 && t2 <= 1.001) {
                        if (justCount) {
                            res++;
                        } else {
                            res.push({
                                x: is.x,
                                y: is.y,
                                t1: mmin(t1, 1),
                                t2: mmin(t2, 1)
                            });
                        }
                    }
                }
            }
        }
        return res;
    }
    /*\
     * Raphael.pathIntersection
     [ method ]
     **
     * Utility method
     **
     * Finds intersections of two paths
     > Parameters
     - path1 (string) path string
     - path2 (string) path string
     = (array) dots of intersection
     o [
     o     {
     o         x: (number) x coordinate of the point
     o         y: (number) y coordinate of the point
     o         t1: (number) t value for segment of path1
     o         t2: (number) t value for segment of path2
     o         segment1: (number) order number for segment of path1
     o         segment2: (number) order number for segment of path2
     o         bez1: (array) eight coordinates representing beziér curve for the segment of path1
     o         bez2: (array) eight coordinates representing beziér curve for the segment of path2
     o     }
     o ]
    \*/
    R.pathIntersection = function (path1, path2) {
        return interPathHelper(path1, path2);
    };
    R.pathIntersectionNumber = function (path1, path2) {
        return interPathHelper(path1, path2, 1);
    };
    function interPathHelper(path1, path2, justCount) {
        path1 = R._path2curve(path1);
        path2 = R._path2curve(path2);
        var x1, y1, x2, y2, x1m, y1m, x2m, y2m, bez1, bez2,
            res = justCount ? 0 : [];
        for (var i = 0, ii = path1.length; i < ii; i++) {
            var pi = path1[i];
            if (pi[0] == "M") {
                x1 = x1m = pi[1];
                y1 = y1m = pi[2];
            } else {
                if (pi[0] == "C") {
                    bez1 = [x1, y1].concat(pi.slice(1));
                    x1 = bez1[6];
                    y1 = bez1[7];
                } else {
                    bez1 = [x1, y1, x1, y1, x1m, y1m, x1m, y1m];
                    x1 = x1m;
                    y1 = y1m;
                }
                for (var j = 0, jj = path2.length; j < jj; j++) {
                    var pj = path2[j];
                    if (pj[0] == "M") {
                        x2 = x2m = pj[1];
                        y2 = y2m = pj[2];
                    } else {
                        if (pj[0] == "C") {
                            bez2 = [x2, y2].concat(pj.slice(1));
                            x2 = bez2[6];
                            y2 = bez2[7];
                        } else {
                            bez2 = [x2, y2, x2, y2, x2m, y2m, x2m, y2m];
                            x2 = x2m;
                            y2 = y2m;
                        }
                        var intr = interHelper(bez1, bez2, justCount);
                        if (justCount) {
                            res += intr;
                        } else {
                            for (var k = 0, kk = intr.length; k < kk; k++) {
                                intr[k].segment1 = i;
                                intr[k].segment2 = j;
                                intr[k].bez1 = bez1;
                                intr[k].bez2 = bez2;
                            }
                            res = res.concat(intr);
                        }
                    }
                }
            }
        }
        return res;
    }
    /*\
     * Raphael.isPointInsidePath
     [ method ]
     **
     * Utility method
     **
     * Returns `true` if given point is inside a given closed path.
     > Parameters
     - path (string) path string
     - x (number) x of the point
     - y (number) y of the point
     = (boolean) true, if point is inside the path
    \*/
    R.isPointInsidePath = function (path, x, y) {
        var bbox = R.pathBBox(path);
        return R.isPointInsideBBox(bbox, x, y) &&
               interPathHelper(path, [["M", x, y], ["H", bbox.x2 + 10]], 1) % 2 == 1;
    };
    R._removedFactory = function (methodname) {
        return function () {
            eve("raphael.log", null, "Rapha\xebl: you are calling to method \u201c" + methodname + "\u201d of removed object", methodname);
        };
    };
    /*\
     * Raphael.pathBBox
     [ method ]
     **
     * Utility method
     **
     * Return bounding box of a given path
     > Parameters
     - path (string) path string
     = (object) bounding box
     o {
     o     x: (number) x coordinate of the left top point of the box
     o     y: (number) y coordinate of the left top point of the box
     o     x2: (number) x coordinate of the right bottom point of the box
     o     y2: (number) y coordinate of the right bottom point of the box
     o     width: (number) width of the box
     o     height: (number) height of the box
     o     cx: (number) x coordinate of the center of the box
     o     cy: (number) y coordinate of the center of the box
     o }
    \*/
    var pathDimensions = R.pathBBox = function (path) {
        var pth = paths(path);
        if (pth.bbox) {
            return clone(pth.bbox);
        }
        if (!path) {
            return {x: 0, y: 0, width: 0, height: 0, x2: 0, y2: 0};
        }
        path = path2curve(path);
        var x = 0,
            y = 0,
            X = [],
            Y = [],
            p;
        for (var i = 0, ii = path.length; i < ii; i++) {
            p = path[i];
            if (p[0] == "M") {
                x = p[1];
                y = p[2];
                X.push(x);
                Y.push(y);
            } else {
                var dim = curveDim(x, y, p[1], p[2], p[3], p[4], p[5], p[6]);
                X = X[concat](dim.min.x, dim.max.x);
                Y = Y[concat](dim.min.y, dim.max.y);
                x = p[5];
                y = p[6];
            }
        }
        var xmin = mmin[apply](0, X),
            ymin = mmin[apply](0, Y),
            xmax = mmax[apply](0, X),
            ymax = mmax[apply](0, Y),
            width = xmax - xmin,
            height = ymax - ymin,
                bb = {
                x: xmin,
                y: ymin,
                x2: xmax,
                y2: ymax,
                width: width,
                height: height,
                cx: xmin + width / 2,
                cy: ymin + height / 2
            };
        pth.bbox = clone(bb);
        return bb;
    },
        pathClone = function (pathArray) {
            var res = clone(pathArray);
            res.toString = R._path2string;
            return res;
        },
        pathToRelative = R._pathToRelative = function (pathArray) {
            var pth = paths(pathArray);
            if (pth.rel) {
                return pathClone(pth.rel);
            }
            if (!R.is(pathArray, array) || !R.is(pathArray && pathArray[0], array)) { // rough assumption
                pathArray = R.parsePathString(pathArray);
            }
            var res = [],
                x = 0,
                y = 0,
                mx = 0,
                my = 0,
                start = 0;
            if (pathArray[0][0] == "M") {
                x = pathArray[0][1];
                y = pathArray[0][2];
                mx = x;
                my = y;
                start++;
                res.push(["M", x, y]);
            }
            for (var i = start, ii = pathArray.length; i < ii; i++) {
                var r = res[i] = [],
                    pa = pathArray[i];
                if (pa[0] != lowerCase.call(pa[0])) {
                    r[0] = lowerCase.call(pa[0]);
                    switch (r[0]) {
                        case "a":
                            r[1] = pa[1];
                            r[2] = pa[2];
                            r[3] = pa[3];
                            r[4] = pa[4];
                            r[5] = pa[5];
                            r[6] = +(pa[6] - x).toFixed(3);
                            r[7] = +(pa[7] - y).toFixed(3);
                            break;
                        case "v":
                            r[1] = +(pa[1] - y).toFixed(3);
                            break;
                        case "m":
                            mx = pa[1];
                            my = pa[2];
                        default:
                            for (var j = 1, jj = pa.length; j < jj; j++) {
                                r[j] = +(pa[j] - ((j % 2) ? x : y)).toFixed(3);
                            }
                    }
                } else {
                    r = res[i] = [];
                    if (pa[0] == "m") {
                        mx = pa[1] + x;
                        my = pa[2] + y;
                    }
                    for (var k = 0, kk = pa.length; k < kk; k++) {
                        res[i][k] = pa[k];
                    }
                }
                var len = res[i].length;
                switch (res[i][0]) {
                    case "z":
                        x = mx;
                        y = my;
                        break;
                    case "h":
                        x += +res[i][len - 1];
                        break;
                    case "v":
                        y += +res[i][len - 1];
                        break;
                    default:
                        x += +res[i][len - 2];
                        y += +res[i][len - 1];
                }
            }
            res.toString = R._path2string;
            pth.rel = pathClone(res);
            return res;
        },
        pathToAbsolute = R._pathToAbsolute = function (pathArray) {
            var pth = paths(pathArray);
            if (pth.abs) {
                return pathClone(pth.abs);
            }
            if (!R.is(pathArray, array) || !R.is(pathArray && pathArray[0], array)) { // rough assumption
                pathArray = R.parsePathString(pathArray);
            }
            if (!pathArray || !pathArray.length) {
                return [["M", 0, 0]];
            }
            var res = [],
                x = 0,
                y = 0,
                mx = 0,
                my = 0,
                start = 0;
            if (pathArray[0][0] == "M") {
                x = +pathArray[0][1];
                y = +pathArray[0][2];
                mx = x;
                my = y;
                start++;
                res[0] = ["M", x, y];
            }
            var crz = pathArray.length == 3 && pathArray[0][0] == "M" && pathArray[1][0].toUpperCase() == "R" && pathArray[2][0].toUpperCase() == "Z";
            for (var r, pa, i = start, ii = pathArray.length; i < ii; i++) {
                res.push(r = []);
                pa = pathArray[i];
                if (pa[0] != upperCase.call(pa[0])) {
                    r[0] = upperCase.call(pa[0]);
                    switch (r[0]) {
                        case "A":
                            r[1] = pa[1];
                            r[2] = pa[2];
                            r[3] = pa[3];
                            r[4] = pa[4];
                            r[5] = pa[5];
                            r[6] = +(pa[6] + x);
                            r[7] = +(pa[7] + y);
                            break;
                        case "V":
                            r[1] = +pa[1] + y;
                            break;
                        case "H":
                            r[1] = +pa[1] + x;
                            break;
                        case "R":
                            var dots = [x, y][concat](pa.slice(1));
                            for (var j = 2, jj = dots.length; j < jj; j++) {
                                dots[j] = +dots[j] + x;
                                dots[++j] = +dots[j] + y;
                            }
                            res.pop();
                            res = res[concat](catmullRom2bezier(dots, crz));
                            break;
                        case "M":
                            mx = +pa[1] + x;
                            my = +pa[2] + y;
                        default:
                            for (j = 1, jj = pa.length; j < jj; j++) {
                                r[j] = +pa[j] + ((j % 2) ? x : y);
                            }
                    }
                } else if (pa[0] == "R") {
                    dots = [x, y][concat](pa.slice(1));
                    res.pop();
                    res = res[concat](catmullRom2bezier(dots, crz));
                    r = ["R"][concat](pa.slice(-2));
                } else {
                    for (var k = 0, kk = pa.length; k < kk; k++) {
                        r[k] = pa[k];
                    }
                }
                switch (r[0]) {
                    case "Z":
                        x = mx;
                        y = my;
                        break;
                    case "H":
                        x = r[1];
                        break;
                    case "V":
                        y = r[1];
                        break;
                    case "M":
                        mx = r[r.length - 2];
                        my = r[r.length - 1];
                    default:
                        x = r[r.length - 2];
                        y = r[r.length - 1];
                }
            }
            res.toString = R._path2string;
            pth.abs = pathClone(res);
            return res;
        },
        l2c = function (x1, y1, x2, y2) {
            return [x1, y1, x2, y2, x2, y2];
        },
        q2c = function (x1, y1, ax, ay, x2, y2) {
            var _13 = 1 / 3,
                _23 = 2 / 3;
            return [
                    _13 * x1 + _23 * ax,
                    _13 * y1 + _23 * ay,
                    _13 * x2 + _23 * ax,
                    _13 * y2 + _23 * ay,
                    x2,
                    y2
                ];
        },
        a2c = function (x1, y1, rx, ry, angle, large_arc_flag, sweep_flag, x2, y2, recursive) {
            // for more information of where this math came from visit:
            // http://www.w3.org/TR/SVG11/implnote.html#ArcImplementationNotes
            var _120 = PI * 120 / 180,
                rad = PI / 180 * (+angle || 0),
                res = [],
                xy,
                rotate = cacher(function (x, y, rad) {
                    var X = x * math.cos(rad) - y * math.sin(rad),
                        Y = x * math.sin(rad) + y * math.cos(rad);
                    return {x: X, y: Y};
                });
            if (!recursive) {
                xy = rotate(x1, y1, -rad);
                x1 = xy.x;
                y1 = xy.y;
                xy = rotate(x2, y2, -rad);
                x2 = xy.x;
                y2 = xy.y;
                var cos = math.cos(PI / 180 * angle),
                    sin = math.sin(PI / 180 * angle),
                    x = (x1 - x2) / 2,
                    y = (y1 - y2) / 2;
                var h = (x * x) / (rx * rx) + (y * y) / (ry * ry);
                if (h > 1) {
                    h = math.sqrt(h);
                    rx = h * rx;
                    ry = h * ry;
                }
                var rx2 = rx * rx,
                    ry2 = ry * ry,
                    k = (large_arc_flag == sweep_flag ? -1 : 1) *
                        math.sqrt(abs((rx2 * ry2 - rx2 * y * y - ry2 * x * x) / (rx2 * y * y + ry2 * x * x))),
                    cx = k * rx * y / ry + (x1 + x2) / 2,
                    cy = k * -ry * x / rx + (y1 + y2) / 2,
                    f1 = math.asin(((y1 - cy) / ry).toFixed(9)),
                    f2 = math.asin(((y2 - cy) / ry).toFixed(9));

                f1 = x1 < cx ? PI - f1 : f1;
                f2 = x2 < cx ? PI - f2 : f2;
                f1 < 0 && (f1 = PI * 2 + f1);
                f2 < 0 && (f2 = PI * 2 + f2);
                if (sweep_flag && f1 > f2) {
                    f1 = f1 - PI * 2;
                }
                if (!sweep_flag && f2 > f1) {
                    f2 = f2 - PI * 2;
                }
            } else {
                f1 = recursive[0];
                f2 = recursive[1];
                cx = recursive[2];
                cy = recursive[3];
            }
            var df = f2 - f1;
            if (abs(df) > _120) {
                var f2old = f2,
                    x2old = x2,
                    y2old = y2;
                f2 = f1 + _120 * (sweep_flag && f2 > f1 ? 1 : -1);
                x2 = cx + rx * math.cos(f2);
                y2 = cy + ry * math.sin(f2);
                res = a2c(x2, y2, rx, ry, angle, 0, sweep_flag, x2old, y2old, [f2, f2old, cx, cy]);
            }
            df = f2 - f1;
            var c1 = math.cos(f1),
                s1 = math.sin(f1),
                c2 = math.cos(f2),
                s2 = math.sin(f2),
                t = math.tan(df / 4),
                hx = 4 / 3 * rx * t,
                hy = 4 / 3 * ry * t,
                m1 = [x1, y1],
                m2 = [x1 + hx * s1, y1 - hy * c1],
                m3 = [x2 + hx * s2, y2 - hy * c2],
                m4 = [x2, y2];
            m2[0] = 2 * m1[0] - m2[0];
            m2[1] = 2 * m1[1] - m2[1];
            if (recursive) {
                return [m2, m3, m4][concat](res);
            } else {
                res = [m2, m3, m4][concat](res).join()[split](",");
                var newres = [];
                for (var i = 0, ii = res.length; i < ii; i++) {
                    newres[i] = i % 2 ? rotate(res[i - 1], res[i], rad).y : rotate(res[i], res[i + 1], rad).x;
                }
                return newres;
            }
        },
        findDotAtSegment = function (p1x, p1y, c1x, c1y, c2x, c2y, p2x, p2y, t) {
            var t1 = 1 - t;
            return {
                x: pow(t1, 3) * p1x + pow(t1, 2) * 3 * t * c1x + t1 * 3 * t * t * c2x + pow(t, 3) * p2x,
                y: pow(t1, 3) * p1y + pow(t1, 2) * 3 * t * c1y + t1 * 3 * t * t * c2y + pow(t, 3) * p2y
            };
        },
        curveDim = cacher(function (p1x, p1y, c1x, c1y, c2x, c2y, p2x, p2y) {
            var a = (c2x - 2 * c1x + p1x) - (p2x - 2 * c2x + c1x),
                b = 2 * (c1x - p1x) - 2 * (c2x - c1x),
                c = p1x - c1x,
                t1 = (-b + math.sqrt(b * b - 4 * a * c)) / 2 / a,
                t2 = (-b - math.sqrt(b * b - 4 * a * c)) / 2 / a,
                y = [p1y, p2y],
                x = [p1x, p2x],
                dot;
            abs(t1) > "1e12" && (t1 = .5);
            abs(t2) > "1e12" && (t2 = .5);
            if (t1 > 0 && t1 < 1) {
                dot = findDotAtSegment(p1x, p1y, c1x, c1y, c2x, c2y, p2x, p2y, t1);
                x.push(dot.x);
                y.push(dot.y);
            }
            if (t2 > 0 && t2 < 1) {
                dot = findDotAtSegment(p1x, p1y, c1x, c1y, c2x, c2y, p2x, p2y, t2);
                x.push(dot.x);
                y.push(dot.y);
            }
            a = (c2y - 2 * c1y + p1y) - (p2y - 2 * c2y + c1y);
            b = 2 * (c1y - p1y) - 2 * (c2y - c1y);
            c = p1y - c1y;
            t1 = (-b + math.sqrt(b * b - 4 * a * c)) / 2 / a;
            t2 = (-b - math.sqrt(b * b - 4 * a * c)) / 2 / a;
            abs(t1) > "1e12" && (t1 = .5);
            abs(t2) > "1e12" && (t2 = .5);
            if (t1 > 0 && t1 < 1) {
                dot = findDotAtSegment(p1x, p1y, c1x, c1y, c2x, c2y, p2x, p2y, t1);
                x.push(dot.x);
                y.push(dot.y);
            }
            if (t2 > 0 && t2 < 1) {
                dot = findDotAtSegment(p1x, p1y, c1x, c1y, c2x, c2y, p2x, p2y, t2);
                x.push(dot.x);
                y.push(dot.y);
            }
            return {
                min: {x: mmin[apply](0, x), y: mmin[apply](0, y)},
                max: {x: mmax[apply](0, x), y: mmax[apply](0, y)}
            };
        }),
        path2curve = R._path2curve = cacher(function (path, path2) {
            var pth = !path2 && paths(path);
            if (!path2 && pth.curve) {
                return pathClone(pth.curve);
            }
            var p = pathToAbsolute(path),
                p2 = path2 && pathToAbsolute(path2),
                attrs = {x: 0, y: 0, bx: 0, by: 0, X: 0, Y: 0, qx: null, qy: null},
                attrs2 = {x: 0, y: 0, bx: 0, by: 0, X: 0, Y: 0, qx: null, qy: null},
                processPath = function (path, d, pcom) {
                    var nx, ny;
                    if (!path) {
                        return ["C", d.x, d.y, d.x, d.y, d.x, d.y];
                    }
                    !(path[0] in {T:1, Q:1}) && (d.qx = d.qy = null);
                    switch (path[0]) {
                        case "M":
                            d.X = path[1];
                            d.Y = path[2];
                            break;
                        case "A":
                            path = ["C"][concat](a2c[apply](0, [d.x, d.y][concat](path.slice(1))));
                            break;
                        case "S":
                            if (pcom == "C" || pcom == "S") { // In "S" case we have to take into account, if the previous command is C/S.
                                nx = d.x * 2 - d.bx;          // And reflect the previous
                                ny = d.y * 2 - d.by;          // command's control point relative to the current point.
                            }
                            else {                            // or some else or nothing
                                nx = d.x;
                                ny = d.y;
                            }
                            path = ["C", nx, ny][concat](path.slice(1));
                            break;
                        case "T":
                            if (pcom == "Q" || pcom == "T") { // In "T" case we have to take into account, if the previous command is Q/T.
                                d.qx = d.x * 2 - d.qx;        // And make a reflection similar
                                d.qy = d.y * 2 - d.qy;        // to case "S".
                            }
                            else {                            // or something else or nothing
                                d.qx = d.x;
                                d.qy = d.y;
                            }
                            path = ["C"][concat](q2c(d.x, d.y, d.qx, d.qy, path[1], path[2]));
                            break;
                        case "Q":
                            d.qx = path[1];
                            d.qy = path[2];
                            path = ["C"][concat](q2c(d.x, d.y, path[1], path[2], path[3], path[4]));
                            break;
                        case "L":
                            path = ["C"][concat](l2c(d.x, d.y, path[1], path[2]));
                            break;
                        case "H":
                            path = ["C"][concat](l2c(d.x, d.y, path[1], d.y));
                            break;
                        case "V":
                            path = ["C"][concat](l2c(d.x, d.y, d.x, path[1]));
                            break;
                        case "Z":
                            path = ["C"][concat](l2c(d.x, d.y, d.X, d.Y));
                            break;
                    }
                    return path;
                },
                fixArc = function (pp, i) {
                    if (pp[i].length > 7) {
                        pp[i].shift();
                        var pi = pp[i];
                        while (pi.length) {
                            pp.splice(i++, 0, ["C"][concat](pi.splice(0, 6)));
                        }
                        pp.splice(i, 1);
                        ii = mmax(p.length, p2 && p2.length || 0);
                    }
                },
                fixM = function (path1, path2, a1, a2, i) {
                    if (path1 && path2 && path1[i][0] == "M" && path2[i][0] != "M") {
                        path2.splice(i, 0, ["M", a2.x, a2.y]);
                        a1.bx = 0;
                        a1.by = 0;
                        a1.x = path1[i][1];
                        a1.y = path1[i][2];
                        ii = mmax(p.length, p2 && p2.length || 0);
                    }
                };
            for (var i = 0, ii = mmax(p.length, p2 && p2.length || 0); i < ii; i++) {
                p[i] = processPath(p[i], attrs);
                fixArc(p, i);
                p2 && (p2[i] = processPath(p2[i], attrs2));
                p2 && fixArc(p2, i);
                fixM(p, p2, attrs, attrs2, i);
                fixM(p2, p, attrs2, attrs, i);
                var seg = p[i],
                    seg2 = p2 && p2[i],
                    seglen = seg.length,
                    seg2len = p2 && seg2.length;
                attrs.x = seg[seglen - 2];
                attrs.y = seg[seglen - 1];
                attrs.bx = toFloat(seg[seglen - 4]) || attrs.x;
                attrs.by = toFloat(seg[seglen - 3]) || attrs.y;
                attrs2.bx = p2 && (toFloat(seg2[seg2len - 4]) || attrs2.x);
                attrs2.by = p2 && (toFloat(seg2[seg2len - 3]) || attrs2.y);
                attrs2.x = p2 && seg2[seg2len - 2];
                attrs2.y = p2 && seg2[seg2len - 1];
            }
            if (!p2) {
                pth.curve = pathClone(p);
            }
            return p2 ? [p, p2] : p;
        }, null, pathClone),
        parseDots = R._parseDots = cacher(function (gradient) {
            var dots = [];
            for (var i = 0, ii = gradient.length; i < ii; i++) {
                var dot = {},
                    par = gradient[i].match(/^([^:]*):?([\d\.]*)/);
                dot.color = R.getRGB(par[1]);
                if (dot.color.error) {
                    return null;
                }
                dot.color = dot.color.hex;
                par[2] && (dot.offset = par[2] + "%");
                dots.push(dot);
            }
            for (i = 1, ii = dots.length - 1; i < ii; i++) {
                if (!dots[i].offset) {
                    var start = toFloat(dots[i - 1].offset || 0),
                        end = 0;
                    for (var j = i + 1; j < ii; j++) {
                        if (dots[j].offset) {
                            end = dots[j].offset;
                            break;
                        }
                    }
                    if (!end) {
                        end = 100;
                        j = ii;
                    }
                    end = toFloat(end);
                    var d = (end - start) / (j - i + 1);
                    for (; i < j; i++) {
                        start += d;
                        dots[i].offset = start + "%";
                    }
                }
            }
            return dots;
        }),
        tear = R._tear = function (el, paper) {
            el == paper.top && (paper.top = el.prev);
            el == paper.bottom && (paper.bottom = el.next);
            el.next && (el.next.prev = el.prev);
            el.prev && (el.prev.next = el.next);
        },
        tofront = R._tofront = function (el, paper) {
            if (paper.top === el) {
                return;
            }
            tear(el, paper);
            el.next = null;
            el.prev = paper.top;
            paper.top.next = el;
            paper.top = el;
        },
        toback = R._toback = function (el, paper) {
            if (paper.bottom === el) {
                return;
            }
            tear(el, paper);
            el.next = paper.bottom;
            el.prev = null;
            paper.bottom.prev = el;
            paper.bottom = el;
        },
        insertafter = R._insertafter = function (el, el2, paper) {
            tear(el, paper);
            el2 == paper.top && (paper.top = el);
            el2.next && (el2.next.prev = el);
            el.next = el2.next;
            el.prev = el2;
            el2.next = el;
        },
        insertbefore = R._insertbefore = function (el, el2, paper) {
            tear(el, paper);
            el2 == paper.bottom && (paper.bottom = el);
            el2.prev && (el2.prev.next = el);
            el.prev = el2.prev;
            el2.prev = el;
            el.next = el2;
        },
        /*\
         * Raphael.toMatrix
         [ method ]
         **
         * Utility method
         **
         * Returns matrix of transformations applied to a given path
         > Parameters
         - path (string) path string
         - transform (string|array) transformation string
         = (object) @Matrix
        \*/
        toMatrix = R.toMatrix = function (path, transform) {
            var bb = pathDimensions(path),
                el = {
                    _: {
                        transform: E
                    },
                    getBBox: function () {
                        return bb;
                    }
                };
            extractTransform(el, transform);
            return el.matrix;
        },
        /*\
         * Raphael.transformPath
         [ method ]
         **
         * Utility method
         **
         * Returns path transformed by a given transformation
         > Parameters
         - path (string) path string
         - transform (string|array) transformation string
         = (string) path
        \*/
        transformPath = R.transformPath = function (path, transform) {
            return mapPath(path, toMatrix(path, transform));
        },
        extractTransform = R._extractTransform = function (el, tstr) {
            if (tstr == null) {
                return el._.transform;
            }
            tstr = Str(tstr).replace(/\.{3}|\u2026/g, el._.transform || E);
            var tdata = R.parseTransformString(tstr),
                deg = 0,
                dx = 0,
                dy = 0,
                sx = 1,
                sy = 1,
                _ = el._,
                m = new Matrix;
            _.transform = tdata || [];
            if (tdata) {
                for (var i = 0, ii = tdata.length; i < ii; i++) {
                    var t = tdata[i],
                        tlen = t.length,
                        command = Str(t[0]).toLowerCase(),
                        absolute = t[0] != command,
                        inver = absolute ? m.invert() : 0,
                        x1,
                        y1,
                        x2,
                        y2,
                        bb;
                    if (command == "t" && tlen == 3) {
                        if (absolute) {
                            x1 = inver.x(0, 0);
                            y1 = inver.y(0, 0);
                            x2 = inver.x(t[1], t[2]);
                            y2 = inver.y(t[1], t[2]);
                            m.translate(x2 - x1, y2 - y1);
                        } else {
                            m.translate(t[1], t[2]);
                        }
                    } else if (command == "r") {
                        if (tlen == 2) {
                            bb = bb || el.getBBox(1);
                            m.rotate(t[1], bb.x + bb.width / 2, bb.y + bb.height / 2);
                            deg += t[1];
                        } else if (tlen == 4) {
                            if (absolute) {
                                x2 = inver.x(t[2], t[3]);
                                y2 = inver.y(t[2], t[3]);
                                m.rotate(t[1], x2, y2);
                            } else {
                                m.rotate(t[1], t[2], t[3]);
                            }
                            deg += t[1];
                        }
                    } else if (command == "s") {
                        if (tlen == 2 || tlen == 3) {
                            bb = bb || el.getBBox(1);
                            m.scale(t[1], t[tlen - 1], bb.x + bb.width / 2, bb.y + bb.height / 2);
                            sx *= t[1];
                            sy *= t[tlen - 1];
                        } else if (tlen == 5) {
                            if (absolute) {
                                x2 = inver.x(t[3], t[4]);
                                y2 = inver.y(t[3], t[4]);
                                m.scale(t[1], t[2], x2, y2);
                            } else {
                                m.scale(t[1], t[2], t[3], t[4]);
                            }
                            sx *= t[1];
                            sy *= t[2];
                        }
                    } else if (command == "m" && tlen == 7) {
                        m.add(t[1], t[2], t[3], t[4], t[5], t[6]);
                    }
                    _.dirtyT = 1;
                    el.matrix = m;
                }
            }

            /*\
             * Element.matrix
             [ property (object) ]
             **
             * Keeps @Matrix object, which represents element transformation
            \*/
            el.matrix = m;

            _.sx = sx;
            _.sy = sy;
            _.deg = deg;
            _.dx = dx = m.e;
            _.dy = dy = m.f;

            if (sx == 1 && sy == 1 && !deg && _.bbox) {
                _.bbox.x += +dx;
                _.bbox.y += +dy;
            } else {
                _.dirtyT = 1;
            }
        },
        getEmpty = function (item) {
            var l = item[0];
            switch (l.toLowerCase()) {
                case "t": return [l, 0, 0];
                case "m": return [l, 1, 0, 0, 1, 0, 0];
                case "r": if (item.length == 4) {
                    return [l, 0, item[2], item[3]];
                } else {
                    return [l, 0];
                }
                case "s": if (item.length == 5) {
                    return [l, 1, 1, item[3], item[4]];
                } else if (item.length == 3) {
                    return [l, 1, 1];
                } else {
                    return [l, 1];
                }
            }
        },
        equaliseTransform = R._equaliseTransform = function (t1, t2) {
            t2 = Str(t2).replace(/\.{3}|\u2026/g, t1);
            t1 = R.parseTransformString(t1) || [];
            t2 = R.parseTransformString(t2) || [];
            var maxlength = mmax(t1.length, t2.length),
                from = [],
                to = [],
                i = 0, j, jj,
                tt1, tt2;
            for (; i < maxlength; i++) {
                tt1 = t1[i] || getEmpty(t2[i]);
                tt2 = t2[i] || getEmpty(tt1);
                if ((tt1[0] != tt2[0]) ||
                    (tt1[0].toLowerCase() == "r" && (tt1[2] != tt2[2] || tt1[3] != tt2[3])) ||
                    (tt1[0].toLowerCase() == "s" && (tt1[3] != tt2[3] || tt1[4] != tt2[4]))
                    ) {
                    return;
                }
                from[i] = [];
                to[i] = [];
                for (j = 0, jj = mmax(tt1.length, tt2.length); j < jj; j++) {
                    j in tt1 && (from[i][j] = tt1[j]);
                    j in tt2 && (to[i][j] = tt2[j]);
                }
            }
            return {
                from: from,
                to: to
            };
        };
    R._getContainer = function (x, y, w, h) {
        var container;
        container = h == null && !R.is(x, "object") ? g.doc.getElementById(x) : x;
        if (container == null) {
            return;
        }
        if (container.tagName) {
            if (y == null) {
                return {
                    container: container,
                    width: container.style.pixelWidth || container.offsetWidth,
                    height: container.style.pixelHeight || container.offsetHeight
                };
            } else {
                return {
                    container: container,
                    width: y,
                    height: w
                };
            }
        }
        return {
            container: 1,
            x: x,
            y: y,
            width: w,
            height: h
        };
    };
    /*\
     * Raphael.pathToRelative
     [ method ]
     **
     * Utility method
     **
     * Converts path to relative form
     > Parameters
     - pathString (string|array) path string or array of segments
     = (array) array of segments.
    \*/
    R.pathToRelative = pathToRelative;
    R._engine = {};
    /*\
     * Raphael.path2curve
     [ method ]
     **
     * Utility method
     **
     * Converts path to a new path where all segments are cubic bezier curves.
     > Parameters
     - pathString (string|array) path string or array of segments
     = (array) array of segments.
    \*/
    R.path2curve = path2curve;
    /*\
     * Raphael.matrix
     [ method ]
     **
     * Utility method
     **
     * Returns matrix based on given parameters.
     > Parameters
     - a (number)
     - b (number)
     - c (number)
     - d (number)
     - e (number)
     - f (number)
     = (object) @Matrix
    \*/
    R.matrix = function (a, b, c, d, e, f) {
        return new Matrix(a, b, c, d, e, f);
    };
    function Matrix(a, b, c, d, e, f) {
        if (a != null) {
            this.a = +a;
            this.b = +b;
            this.c = +c;
            this.d = +d;
            this.e = +e;
            this.f = +f;
        } else {
            this.a = 1;
            this.b = 0;
            this.c = 0;
            this.d = 1;
            this.e = 0;
            this.f = 0;
        }
    }
    (function (matrixproto) {
        /*\
         * Matrix.add
         [ method ]
         **
         * Adds given matrix to existing one.
         > Parameters
         - a (number)
         - b (number)
         - c (number)
         - d (number)
         - e (number)
         - f (number)
         or
         - matrix (object) @Matrix
        \*/
        matrixproto.add = function (a, b, c, d, e, f) {
            var out = [[], [], []],
                m = [[this.a, this.c, this.e], [this.b, this.d, this.f], [0, 0, 1]],
                matrix = [[a, c, e], [b, d, f], [0, 0, 1]],
                x, y, z, res;

            if (a && a instanceof Matrix) {
                matrix = [[a.a, a.c, a.e], [a.b, a.d, a.f], [0, 0, 1]];
            }

            for (x = 0; x < 3; x++) {
                for (y = 0; y < 3; y++) {
                    res = 0;
                    for (z = 0; z < 3; z++) {
                        res += m[x][z] * matrix[z][y];
                    }
                    out[x][y] = res;
                }
            }
            this.a = out[0][0];
            this.b = out[1][0];
            this.c = out[0][1];
            this.d = out[1][1];
            this.e = out[0][2];
            this.f = out[1][2];
        };
        /*\
         * Matrix.invert
         [ method ]
         **
         * Returns inverted version of the matrix
         = (object) @Matrix
        \*/
        matrixproto.invert = function () {
            var me = this,
                x = me.a * me.d - me.b * me.c;
            return new Matrix(me.d / x, -me.b / x, -me.c / x, me.a / x, (me.c * me.f - me.d * me.e) / x, (me.b * me.e - me.a * me.f) / x);
        };
        /*\
         * Matrix.clone
         [ method ]
         **
         * Returns copy of the matrix
         = (object) @Matrix
        \*/
        matrixproto.clone = function () {
            return new Matrix(this.a, this.b, this.c, this.d, this.e, this.f);
        };
        /*\
         * Matrix.translate
         [ method ]
         **
         * Translate the matrix
         > Parameters
         - x (number)
         - y (number)
        \*/
        matrixproto.translate = function (x, y) {
            this.add(1, 0, 0, 1, x, y);
        };
        /*\
         * Matrix.scale
         [ method ]
         **
         * Scales the matrix
         > Parameters
         - x (number)
         - y (number) #optional
         - cx (number) #optional
         - cy (number) #optional
        \*/
        matrixproto.scale = function (x, y, cx, cy) {
            y == null && (y = x);
            (cx || cy) && this.add(1, 0, 0, 1, cx, cy);
            this.add(x, 0, 0, y, 0, 0);
            (cx || cy) && this.add(1, 0, 0, 1, -cx, -cy);
        };
        /*\
         * Matrix.rotate
         [ method ]
         **
         * Rotates the matrix
         > Parameters
         - a (number)
         - x (number)
         - y (number)
        \*/
        matrixproto.rotate = function (a, x, y) {
            a = R.rad(a);
            x = x || 0;
            y = y || 0;
            var cos = +math.cos(a).toFixed(9),
                sin = +math.sin(a).toFixed(9);
            this.add(cos, sin, -sin, cos, x, y);
            this.add(1, 0, 0, 1, -x, -y);
        };
        /*\
         * Matrix.x
         [ method ]
         **
         * Return x coordinate for given point after transformation described by the matrix. See also @Matrix.y
         > Parameters
         - x (number)
         - y (number)
         = (number) x
        \*/
        matrixproto.x = function (x, y) {
            return x * this.a + y * this.c + this.e;
        };
        /*\
         * Matrix.y
         [ method ]
         **
         * Return y coordinate for given point after transformation described by the matrix. See also @Matrix.x
         > Parameters
         - x (number)
         - y (number)
         = (number) y
        \*/
        matrixproto.y = function (x, y) {
            return x * this.b + y * this.d + this.f;
        };
        matrixproto.get = function (i) {
            return +this[Str.fromCharCode(97 + i)].toFixed(4);
        };
        matrixproto.toString = function () {
            return R.svg ?
                "matrix(" + [this.get(0), this.get(1), this.get(2), this.get(3), this.get(4), this.get(5)].join() + ")" :
                [this.get(0), this.get(2), this.get(1), this.get(3), 0, 0].join();
        };
        matrixproto.toFilter = function () {
            return "progid:DXImageTransform.Microsoft.Matrix(M11=" + this.get(0) +
                ", M12=" + this.get(2) + ", M21=" + this.get(1) + ", M22=" + this.get(3) +
                ", Dx=" + this.get(4) + ", Dy=" + this.get(5) + ", sizingmethod='auto expand')";
        };
        matrixproto.offset = function () {
            return [this.e.toFixed(4), this.f.toFixed(4)];
        };
        function norm(a) {
            return a[0] * a[0] + a[1] * a[1];
        }
        function normalize(a) {
            var mag = math.sqrt(norm(a));
            a[0] && (a[0] /= mag);
            a[1] && (a[1] /= mag);
        }
        /*\
         * Matrix.split
         [ method ]
         **
         * Splits matrix into primitive transformations
         = (object) in format:
         o dx (number) translation by x
         o dy (number) translation by y
         o scalex (number) scale by x
         o scaley (number) scale by y
         o shear (number) shear
         o rotate (number) rotation in deg
         o isSimple (boolean) could it be represented via simple transformations
        \*/
        matrixproto.split = function () {
            var out = {};
            // translation
            out.dx = this.e;
            out.dy = this.f;

            // scale and shear
            var row = [[this.a, this.c], [this.b, this.d]];
            out.scalex = math.sqrt(norm(row[0]));
            normalize(row[0]);

            out.shear = row[0][0] * row[1][0] + row[0][1] * row[1][1];
            row[1] = [row[1][0] - row[0][0] * out.shear, row[1][1] - row[0][1] * out.shear];

            out.scaley = math.sqrt(norm(row[1]));
            normalize(row[1]);
            out.shear /= out.scaley;

            // rotation
            var sin = -row[0][1],
                cos = row[1][1];
            if (cos < 0) {
                out.rotate = R.deg(math.acos(cos));
                if (sin < 0) {
                    out.rotate = 360 - out.rotate;
                }
            } else {
                out.rotate = R.deg(math.asin(sin));
            }

            out.isSimple = !+out.shear.toFixed(9) && (out.scalex.toFixed(9) == out.scaley.toFixed(9) || !out.rotate);
            out.isSuperSimple = !+out.shear.toFixed(9) && out.scalex.toFixed(9) == out.scaley.toFixed(9) && !out.rotate;
            out.noRotation = !+out.shear.toFixed(9) && !out.rotate;
            return out;
        };
        /*\
         * Matrix.toTransformString
         [ method ]
         **
         * Return transform string that represents given matrix
         = (string) transform string
        \*/
        matrixproto.toTransformString = function (shorter) {
            var s = shorter || this[split]();
            if (s.isSimple) {
                s.scalex = +s.scalex.toFixed(4);
                s.scaley = +s.scaley.toFixed(4);
                s.rotate = +s.rotate.toFixed(4);
                return  (s.dx || s.dy ? "t" + [s.dx, s.dy] : E) +
                        (s.scalex != 1 || s.scaley != 1 ? "s" + [s.scalex, s.scaley, 0, 0] : E) +
                        (s.rotate ? "r" + [s.rotate, 0, 0] : E);
            } else {
                return "m" + [this.get(0), this.get(1), this.get(2), this.get(3), this.get(4), this.get(5)];
            }
        };
    })(Matrix.prototype);

    // WebKit rendering bug workaround method
    var version = navigator.userAgent.match(/Version\/(.*?)\s/) || navigator.userAgent.match(/Chrome\/(\d+)/);
    if ((navigator.vendor == "Apple Computer, Inc.") && (version && version[1] < 4 || navigator.platform.slice(0, 2) == "iP") ||
        (navigator.vendor == "Google Inc." && version && version[1] < 8)) {
        /*\
         * Paper.safari
         [ method ]
         **
         * There is an inconvenient rendering bug in Safari (WebKit):
         * sometimes the rendering should be forced.
         * This method should help with dealing with this bug.
        \*/
        paperproto.safari = function () {
            var rect = this.rect(-99, -99, this.width + 99, this.height + 99).attr({stroke: "none"});
            setTimeout(function () {rect.remove();});
        };
    } else {
        paperproto.safari = fun;
    }

    var preventDefault = function () {
        this.returnValue = false;
    },
    preventTouch = function () {
        return this.originalEvent.preventDefault();
    },
    stopPropagation = function () {
        this.cancelBubble = true;
    },
    stopTouch = function () {
        return this.originalEvent.stopPropagation();
    },
    getEventPosition = function (e) {
        var scrollY = g.doc.documentElement.scrollTop || g.doc.body.scrollTop,
            scrollX = g.doc.documentElement.scrollLeft || g.doc.body.scrollLeft;

        return {
            x: e.clientX + scrollX,
            y: e.clientY + scrollY
        };
    },
    addEvent = (function () {
        if (g.doc.addEventListener) {
            return function (obj, type, fn, element) {
                var f = function (e) {
                    var pos = getEventPosition(e);
                    return fn.call(element, e, pos.x, pos.y);
                };
                obj.addEventListener(type, f, false);

                if (supportsTouch && touchMap[type]) {
                    var _f = function (e) {
                        var pos = getEventPosition(e),
                            olde = e;

                        for (var i = 0, ii = e.targetTouches && e.targetTouches.length; i < ii; i++) {
                            if (e.targetTouches[i].target == obj) {
                                e = e.targetTouches[i];
                                e.originalEvent = olde;
                                e.preventDefault = preventTouch;
                                e.stopPropagation = stopTouch;
                                break;
                            }
                        }

                        return fn.call(element, e, pos.x, pos.y);
                    };
                    obj.addEventListener(touchMap[type], _f, false);
                }

                return function () {
                    obj.removeEventListener(type, f, false);

                    if (supportsTouch && touchMap[type])
                        obj.removeEventListener(touchMap[type], f, false);

                    return true;
                };
            };
        } else if (g.doc.attachEvent) {
            return function (obj, type, fn, element) {
                var f = function (e) {
                    e = e || g.win.event;
                    var scrollY = g.doc.documentElement.scrollTop || g.doc.body.scrollTop,
                        scrollX = g.doc.documentElement.scrollLeft || g.doc.body.scrollLeft,
                        x = e.clientX + scrollX,
                        y = e.clientY + scrollY;
                    e.preventDefault = e.preventDefault || preventDefault;
                    e.stopPropagation = e.stopPropagation || stopPropagation;
                    return fn.call(element, e, x, y);
                };
                obj.attachEvent("on" + type, f);
                var detacher = function () {
                    obj.detachEvent("on" + type, f);
                    return true;
                };
                return detacher;
            };
        }
    })(),
    drag = [],
    dragMove = function (e) {
        var x = e.clientX,
            y = e.clientY,
            scrollY = g.doc.documentElement.scrollTop || g.doc.body.scrollTop,
            scrollX = g.doc.documentElement.scrollLeft || g.doc.body.scrollLeft,
            dragi,
            j = drag.length;
        while (j--) {
            dragi = drag[j];
            if (supportsTouch && e.touches) {
                var i = e.touches.length,
                    touch;
                while (i--) {
                    touch = e.touches[i];
                    if (touch.identifier == dragi.el._drag.id) {
                        x = touch.clientX;
                        y = touch.clientY;
                        (e.originalEvent ? e.originalEvent : e).preventDefault();
                        break;
                    }
                }
            } else {
                e.preventDefault();
            }
            var node = dragi.el.node,
                o,
                next = node.nextSibling,
                parent = node.parentNode,
                display = node.style.display;
            g.win.opera && parent.removeChild(node);
            node.style.display = "none";
            o = dragi.el.paper.getElementByPoint(x, y);
            node.style.display = display;
            g.win.opera && (next ? parent.insertBefore(node, next) : parent.appendChild(node));
            o && eve("raphael.drag.over." + dragi.el.id, dragi.el, o);
            x += scrollX;
            y += scrollY;
            eve("raphael.drag.move." + dragi.el.id, dragi.move_scope || dragi.el, x - dragi.el._drag.x, y - dragi.el._drag.y, x, y, e);
        }
    },
    dragUp = function (e) {
        R.unmousemove(dragMove).unmouseup(dragUp);
        var i = drag.length,
            dragi;
        while (i--) {
            dragi = drag[i];
            dragi.el._drag = {};
            eve("raphael.drag.end." + dragi.el.id, dragi.end_scope || dragi.start_scope || dragi.move_scope || dragi.el, e);
        }
        drag = [];
    },
    /*\
     * Raphael.el
     [ property (object) ]
     **
     * You can add your own method to elements. This is usefull when you want to hack default functionality or
     * want to wrap some common transformation or attributes in one method. In difference to canvas methods,
     * you can redefine element method at any time. Expending element methods wouldn’t affect set.
     > Usage
     | Raphael.el.red = function () {
     |     this.attr({fill: "#f00"});
     | };
     | // then use it
     | paper.circle(100, 100, 20).red();
    \*/
    elproto = R.el = {};
    /*\
     * Element.click
     [ method ]
     **
     * Adds event handler for click for the element.
     > Parameters
     - handler (function) handler for the event
     = (object) @Element
    \*/
    /*\
     * Element.unclick
     [ method ]
     **
     * Removes event handler for click for the element.
     > Parameters
     - handler (function) #optional handler for the event
     = (object) @Element
    \*/

    /*\
     * Element.dblclick
     [ method ]
     **
     * Adds event handler for double click for the element.
     > Parameters
     - handler (function) handler for the event
     = (object) @Element
    \*/
    /*\
     * Element.undblclick
     [ method ]
     **
     * Removes event handler for double click for the element.
     > Parameters
     - handler (function) #optional handler for the event
     = (object) @Element
    \*/

    /*\
     * Element.mousedown
     [ method ]
     **
     * Adds event handler for mousedown for the element.
     > Parameters
     - handler (function) handler for the event
     = (object) @Element
    \*/
    /*\
     * Element.unmousedown
     [ method ]
     **
     * Removes event handler for mousedown for the element.
     > Parameters
     - handler (function) #optional handler for the event
     = (object) @Element
    \*/

    /*\
     * Element.mousemove
     [ method ]
     **
     * Adds event handler for mousemove for the element.
     > Parameters
     - handler (function) handler for the event
     = (object) @Element
    \*/
    /*\
     * Element.unmousemove
     [ method ]
     **
     * Removes event handler for mousemove for the element.
     > Parameters
     - handler (function) #optional handler for the event
     = (object) @Element
    \*/

    /*\
     * Element.mouseout
     [ method ]
     **
     * Adds event handler for mouseout for the element.
     > Parameters
     - handler (function) handler for the event
     = (object) @Element
    \*/
    /*\
     * Element.unmouseout
     [ method ]
     **
     * Removes event handler for mouseout for the element.
     > Parameters
     - handler (function) #optional handler for the event
     = (object) @Element
    \*/

    /*\
     * Element.mouseover
     [ method ]
     **
     * Adds event handler for mouseover for the element.
     > Parameters
     - handler (function) handler for the event
     = (object) @Element
    \*/
    /*\
     * Element.unmouseover
     [ method ]
     **
     * Removes event handler for mouseover for the element.
     > Parameters
     - handler (function) #optional handler for the event
     = (object) @Element
    \*/

    /*\
     * Element.mouseup
     [ method ]
     **
     * Adds event handler for mouseup for the element.
     > Parameters
     - handler (function) handler for the event
     = (object) @Element
    \*/
    /*\
     * Element.unmouseup
     [ method ]
     **
     * Removes event handler for mouseup for the element.
     > Parameters
     - handler (function) #optional handler for the event
     = (object) @Element
    \*/

    /*\
     * Element.touchstart
     [ method ]
     **
     * Adds event handler for touchstart for the element.
     > Parameters
     - handler (function) handler for the event
     = (object) @Element
    \*/
    /*\
     * Element.untouchstart
     [ method ]
     **
     * Removes event handler for touchstart for the element.
     > Parameters
     - handler (function) #optional handler for the event
     = (object) @Element
    \*/

    /*\
     * Element.touchmove
     [ method ]
     **
     * Adds event handler for touchmove for the element.
     > Parameters
     - handler (function) handler for the event
     = (object) @Element
    \*/
    /*\
     * Element.untouchmove
     [ method ]
     **
     * Removes event handler for touchmove for the element.
     > Parameters
     - handler (function) #optional handler for the event
     = (object) @Element
    \*/

    /*\
     * Element.touchend
     [ method ]
     **
     * Adds event handler for touchend for the element.
     > Parameters
     - handler (function) handler for the event
     = (object) @Element
    \*/
    /*\
     * Element.untouchend
     [ method ]
     **
     * Removes event handler for touchend for the element.
     > Parameters
     - handler (function) #optional handler for the event
     = (object) @Element
    \*/

    /*\
     * Element.touchcancel
     [ method ]
     **
     * Adds event handler for touchcancel for the element.
     > Parameters
     - handler (function) handler for the event
     = (object) @Element
    \*/
    /*\
     * Element.untouchcancel
     [ method ]
     **
     * Removes event handler for touchcancel for the element.
     > Parameters
     - handler (function) #optional handler for the event
     = (object) @Element
    \*/
    for (var i = events.length; i--;) {
        (function (eventName) {
            R[eventName] = elproto[eventName] = function (fn, scope) {
                if (R.is(fn, "function")) {
                    this.events = this.events || [];
                    this.events.push({name: eventName, f: fn, unbind: addEvent(this.shape || this.node || g.doc, eventName, fn, scope || this)});
                }
                return this;
            };
            R["un" + eventName] = elproto["un" + eventName] = function (fn) {
                var events = this.events || [],
                    l = events.length;
                while (l--){
                    if (events[l].name == eventName && (R.is(fn, "undefined") || events[l].f == fn)) {
                        events[l].unbind();
                        events.splice(l, 1);
                        !events.length && delete this.events;
                    }
                }
                return this;
            };
        })(events[i]);
    }

    /*\
     * Element.data
     [ method ]
     **
     * Adds or retrieves given value asociated with given key.
     ** 
     * See also @Element.removeData
     > Parameters
     - key (string) key to store data
     - value (any) #optional value to store
     = (object) @Element
     * or, if value is not specified:
     = (any) value
     * or, if key and value are not specified:
     = (object) Key/value pairs for all the data associated with the element.
     > Usage
     | for (var i = 0, i < 5, i++) {
     |     paper.circle(10 + 15 * i, 10, 10)
     |          .attr({fill: "#000"})
     |          .data("i", i)
     |          .click(function () {
     |             alert(this.data("i"));
     |          });
     | }
    \*/
    elproto.data = function (key, value) {
        var data = eldata[this.id] = eldata[this.id] || {};
        if (arguments.length == 0) {
            return data;
        }
        if (arguments.length == 1) {
            if (R.is(key, "object")) {
                for (var i in key) if (key[has](i)) {
                    this.data(i, key[i]);
                }
                return this;
            }
            eve("raphael.data.get." + this.id, this, data[key], key);
            return data[key];
        }
        data[key] = value;
        eve("raphael.data.set." + this.id, this, value, key);
        return this;
    };
    /*\
     * Element.removeData
     [ method ]
     **
     * Removes value associated with an element by given key.
     * If key is not provided, removes all the data of the element.
     > Parameters
     - key (string) #optional key
     = (object) @Element
    \*/
    elproto.removeData = function (key) {
        if (key == null) {
            eldata[this.id] = {};
        } else {
            eldata[this.id] && delete eldata[this.id][key];
        }
        return this;
    };
     /*\
     * Element.getData
     [ method ]
     **
     * Retrieves the element data
     = (object) data
    \*/
    elproto.getData = function () {
        return clone(eldata[this.id] || {});
    };
    /*\
     * Element.hover
     [ method ]
     **
     * Adds event handlers for hover for the element.
     > Parameters
     - f_in (function) handler for hover in
     - f_out (function) handler for hover out
     - icontext (object) #optional context for hover in handler
     - ocontext (object) #optional context for hover out handler
     = (object) @Element
    \*/
    elproto.hover = function (f_in, f_out, scope_in, scope_out) {
        return this.mouseover(f_in, scope_in).mouseout(f_out, scope_out || scope_in);
    };
    /*\
     * Element.unhover
     [ method ]
     **
     * Removes event handlers for hover for the element.
     > Parameters
     - f_in (function) handler for hover in
     - f_out (function) handler for hover out
     = (object) @Element
    \*/
    elproto.unhover = function (f_in, f_out) {
        return this.unmouseover(f_in).unmouseout(f_out);
    };
    var draggable = [];
    /*\
     * Element.drag
     [ method ]
     **
     * Adds event handlers for drag of the element.
     > Parameters
     - onmove (function) handler for moving
     - onstart (function) handler for drag start
     - onend (function) handler for drag end
     - mcontext (object) #optional context for moving handler
     - scontext (object) #optional context for drag start handler
     - econtext (object) #optional context for drag end handler
     * Additionaly following `drag` events will be triggered: `drag.start.<id>` on start, 
     * `drag.end.<id>` on end and `drag.move.<id>` on every move. When element will be dragged over another element 
     * `drag.over.<id>` will be fired as well.
     *
     * Start event and start handler will be called in specified context or in context of the element with following parameters:
     o x (number) x position of the mouse
     o y (number) y position of the mouse
     o event (object) DOM event object
     * Move event and move handler will be called in specified context or in context of the element with following parameters:
     o dx (number) shift by x from the start point
     o dy (number) shift by y from the start point
     o x (number) x position of the mouse
     o y (number) y position of the mouse
     o event (object) DOM event object
     * End event and end handler will be called in specified context or in context of the element with following parameters:
     o event (object) DOM event object
     = (object) @Element
    \*/
    elproto.drag = function (onmove, onstart, onend, move_scope, start_scope, end_scope) {
        function start(e) {
            (e.originalEvent || e).preventDefault();
            var x = e.clientX,
                y = e.clientY,
                scrollY = g.doc.documentElement.scrollTop || g.doc.body.scrollTop,
                scrollX = g.doc.documentElement.scrollLeft || g.doc.body.scrollLeft;
            this._drag.id = e.identifier;
            if (supportsTouch && e.touches) {
                var i = e.touches.length, touch;
                while (i--) {
                    touch = e.touches[i];
                    this._drag.id = touch.identifier;
                    if (touch.identifier == this._drag.id) {
                        x = touch.clientX;
                        y = touch.clientY;
                        break;
                    }
                }
            }
            this._drag.x = x + scrollX;
            this._drag.y = y + scrollY;
            !drag.length && R.mousemove(dragMove).mouseup(dragUp);
            drag.push({el: this, move_scope: move_scope, start_scope: start_scope, end_scope: end_scope});
            onstart && eve.on("raphael.drag.start." + this.id, onstart);
            onmove && eve.on("raphael.drag.move." + this.id, onmove);
            onend && eve.on("raphael.drag.end." + this.id, onend);
            eve("raphael.drag.start." + this.id, start_scope || move_scope || this, e.clientX + scrollX, e.clientY + scrollY, e);
        }
        this._drag = {};
        draggable.push({el: this, start: start});
        this.mousedown(start);
        return this;
    };
    /*\
     * Element.onDragOver
     [ method ]
     **
     * Shortcut for assigning event handler for `drag.over.<id>` event, where id is id of the element (see @Element.id).
     > Parameters
     - f (function) handler for event, first argument would be the element you are dragging over
    \*/
    elproto.onDragOver = function (f) {
        f ? eve.on("raphael.drag.over." + this.id, f) : eve.unbind("raphael.drag.over." + this.id);
    };
    /*\
     * Element.undrag
     [ method ]
     **
     * Removes all drag event handlers from given element.
    \*/
    elproto.undrag = function () {
        var i = draggable.length;
        while (i--) if (draggable[i].el == this) {
            this.unmousedown(draggable[i].start);
            draggable.splice(i, 1);
            eve.unbind("raphael.drag.*." + this.id);
        }
        !draggable.length && R.unmousemove(dragMove).unmouseup(dragUp);
        drag = [];
    };
    /*\
     * Paper.circle
     [ method ]
     **
     * Draws a circle.
     **
     > Parameters
     **
     - x (number) x coordinate of the centre
     - y (number) y coordinate of the centre
     - r (number) radius
     = (object) Raphaël element object with type “circle”
     **
     > Usage
     | var c = paper.circle(50, 50, 40);
    \*/
    paperproto.circle = function (x, y, r) {
        var out = R._engine.circle(this, x || 0, y || 0, r || 0);
        this.__set__ && this.__set__.push(out);
        return out;
    };
    /*\
     * Paper.rect
     [ method ]
     *
     * Draws a rectangle.
     **
     > Parameters
     **
     - x (number) x coordinate of the top left corner
     - y (number) y coordinate of the top left corner
     - width (number) width
     - height (number) height
     - r (number) #optional radius for rounded corners, default is 0
     = (object) Raphaël element object with type “rect”
     **
     > Usage
     | // regular rectangle
     | var c = paper.rect(10, 10, 50, 50);
     | // rectangle with rounded corners
     | var c = paper.rect(40, 40, 50, 50, 10);
    \*/
    paperproto.rect = function (x, y, w, h, r) {
        var out = R._engine.rect(this, x || 0, y || 0, w || 0, h || 0, r || 0);
        this.__set__ && this.__set__.push(out);
        return out;
    };
    /*\
     * Paper.ellipse
     [ method ]
     **
     * Draws an ellipse.
     **
     > Parameters
     **
     - x (number) x coordinate of the centre
     - y (number) y coordinate of the centre
     - rx (number) horizontal radius
     - ry (number) vertical radius
     = (object) Raphaël element object with type “ellipse”
     **
     > Usage
     | var c = paper.ellipse(50, 50, 40, 20);
    \*/
    paperproto.ellipse = function (x, y, rx, ry) {
        var out = R._engine.ellipse(this, x || 0, y || 0, rx || 0, ry || 0);
        this.__set__ && this.__set__.push(out);
        return out;
    };
    /*\
     * Paper.path
     [ method ]
     **
     * Creates a path element by given path data string.
     > Parameters
     - pathString (string) #optional path string in SVG format.
     * Path string consists of one-letter commands, followed by comma seprarated arguments in numercal form. Example:
     | "M10,20L30,40"
     * Here we can see two commands: “M”, with arguments `(10, 20)` and “L” with arguments `(30, 40)`. Upper case letter mean command is absolute, lower case—relative.
     *
     # <p>Here is short list of commands available, for more details see <a href="http://www.w3.org/TR/SVG/paths.html#PathData" title="Details of a path's data attribute's format are described in the SVG specification.">SVG path string format</a>.</p>
     # <table><thead><tr><th>Command</th><th>Name</th><th>Parameters</th></tr></thead><tbody>
     # <tr><td>M</td><td>moveto</td><td>(x y)+</td></tr>
     # <tr><td>Z</td><td>closepath</td><td>(none)</td></tr>
     # <tr><td>L</td><td>lineto</td><td>(x y)+</td></tr>
     # <tr><td>H</td><td>horizontal lineto</td><td>x+</td></tr>
     # <tr><td>V</td><td>vertical lineto</td><td>y+</td></tr>
     # <tr><td>C</td><td>curveto</td><td>(x1 y1 x2 y2 x y)+</td></tr>
     # <tr><td>S</td><td>smooth curveto</td><td>(x2 y2 x y)+</td></tr>
     # <tr><td>Q</td><td>quadratic Bézier curveto</td><td>(x1 y1 x y)+</td></tr>
     # <tr><td>T</td><td>smooth quadratic Bézier curveto</td><td>(x y)+</td></tr>
     # <tr><td>A</td><td>elliptical arc</td><td>(rx ry x-axis-rotation large-arc-flag sweep-flag x y)+</td></tr>
     # <tr><td>R</td><td><a href="http://en.wikipedia.org/wiki/Catmull–Rom_spline#Catmull.E2.80.93Rom_spline">Catmull-Rom curveto</a>*</td><td>x1 y1 (x y)+</td></tr></tbody></table>
     * * “Catmull-Rom curveto” is a not standard SVG command and added in 2.0 to make life easier.
     * Note: there is a special case when path consist of just three commands: “M10,10R…z”. In this case path will smoothly connects to its beginning.
     > Usage
     | var c = paper.path("M10 10L90 90");
     | // draw a diagonal line:
     | // move to 10,10, line to 90,90
     * For example of path strings, check out these icons: http://raphaeljs.com/icons/
    \*/
    paperproto.path = function (pathString) {
        pathString && !R.is(pathString, string) && !R.is(pathString[0], array) && (pathString += E);
        var out = R._engine.path(R.format[apply](R, arguments), this);
        this.__set__ && this.__set__.push(out);
        return out;
    };
    /*\
     * Paper.image
     [ method ]
     **
     * Embeds an image into the surface.
     **
     > Parameters
     **
     - src (string) URI of the source image
     - x (number) x coordinate position
     - y (number) y coordinate position
     - width (number) width of the image
     - height (number) height of the image
     = (object) Raphaël element object with type “image”
     **
     > Usage
     | var c = paper.image("apple.png", 10, 10, 80, 80);
    \*/
    paperproto.image = function (src, x, y, w, h) {
        var out = R._engine.image(this, src || "about:blank", x || 0, y || 0, w || 0, h || 0);
        this.__set__ && this.__set__.push(out);
        return out;
    };
    /*\
     * Paper.text
     [ method ]
     **
     * Draws a text string. If you need line breaks, put “\n” in the string.
     **
     > Parameters
     **
     - x (number) x coordinate position
     - y (number) y coordinate position
     - text (string) The text string to draw
     = (object) Raphaël element object with type “text”
     **
     > Usage
     | var t = paper.text(50, 50, "Raphaël\nkicks\nbutt!");
    \*/
    paperproto.text = function (x, y, text) {
        var out = R._engine.text(this, x || 0, y || 0, Str(text));
        this.__set__ && this.__set__.push(out);
        return out;
    };
    /*\
     * Paper.set
     [ method ]
     **
     * Creates array-like object to keep and operate several elements at once.
     * Warning: it doesn’t create any elements for itself in the page, it just groups existing elements.
     * Sets act as pseudo elements — all methods available to an element can be used on a set.
     = (object) array-like object that represents set of elements
     **
     > Usage
     | var st = paper.set();
     | st.push(
     |     paper.circle(10, 10, 5),
     |     paper.circle(30, 10, 5)
     | );
     | st.attr({fill: "red"}); // changes the fill of both circles
    \*/
    paperproto.set = function (itemsArray) {
        !R.is(itemsArray, "array") && (itemsArray = Array.prototype.splice.call(arguments, 0, arguments.length));
        var out = new Set(itemsArray);
        this.__set__ && this.__set__.push(out);
        out["paper"] = this;
        out["type"] = "set";
        return out;
    };
    /*\
     * Paper.setStart
     [ method ]
     **
     * Creates @Paper.set. All elements that will be created after calling this method and before calling
     * @Paper.setFinish will be added to the set.
     **
     > Usage
     | paper.setStart();
     | paper.circle(10, 10, 5),
     | paper.circle(30, 10, 5)
     | var st = paper.setFinish();
     | st.attr({fill: "red"}); // changes the fill of both circles
    \*/
    paperproto.setStart = function (set) {
        this.__set__ = set || this.set();
    };
    /*\
     * Paper.setFinish
     [ method ]
     **
     * See @Paper.setStart. This method finishes catching and returns resulting set.
     **
     = (object) set
    \*/
    paperproto.setFinish = function (set) {
        var out = this.__set__;
        delete this.__set__;
        return out;
    };
    /*\
     * Paper.setSize
     [ method ]
     **
     * If you need to change dimensions of the canvas call this method
     **
     > Parameters
     **
     - width (number) new width of the canvas
     - height (number) new height of the canvas
    \*/
    paperproto.setSize = function (width, height) {
        return R._engine.setSize.call(this, width, height);
    };
    /*\
     * Paper.setViewBox
     [ method ]
     **
     * Sets the view box of the paper. Practically it gives you ability to zoom and pan whole paper surface by 
     * specifying new boundaries.
     **
     > Parameters
     **
     - x (number) new x position, default is `0`
     - y (number) new y position, default is `0`
     - w (number) new width of the canvas
     - h (number) new height of the canvas
     - fit (boolean) `true` if you want graphics to fit into new boundary box
    \*/
    paperproto.setViewBox = function (x, y, w, h, fit) {
        return R._engine.setViewBox.call(this, x, y, w, h, fit);
    };
    /*\
     * Paper.top
     [ property ]
     **
     * Points to the topmost element on the paper
    \*/
    /*\
     * Paper.bottom
     [ property ]
     **
     * Points to the bottom element on the paper
    \*/
    paperproto.top = paperproto.bottom = null;
    /*\
     * Paper.raphael
     [ property ]
     **
     * Points to the @Raphael object/function
    \*/
    paperproto.raphael = R;
    var getOffset = function (elem) {
        var box = elem.getBoundingClientRect(),
            doc = elem.ownerDocument,
            body = doc.body,
            docElem = doc.documentElement,
            clientTop = docElem.clientTop || body.clientTop || 0, clientLeft = docElem.clientLeft || body.clientLeft || 0,
            top  = box.top  + (g.win.pageYOffset || docElem.scrollTop || body.scrollTop ) - clientTop,
            left = box.left + (g.win.pageXOffset || docElem.scrollLeft || body.scrollLeft) - clientLeft;
        return {
            y: top,
            x: left
        };
    };
    /*\
     * Paper.getElementByPoint
     [ method ]
     **
     * Returns you topmost element under given point.
     **
     = (object) Raphaël element object
     > Parameters
     **
     - x (number) x coordinate from the top left corner of the window
     - y (number) y coordinate from the top left corner of the window
     > Usage
     | paper.getElementByPoint(mouseX, mouseY).attr({stroke: "#f00"});
    \*/
    paperproto.getElementByPoint = function (x, y) {
        var paper = this,
            svg = paper.canvas,
            target = g.doc.elementFromPoint(x, y);
        if (g.win.opera && target.tagName == "svg") {
            var so = getOffset(svg),
                sr = svg.createSVGRect();
            sr.x = x - so.x;
            sr.y = y - so.y;
            sr.width = sr.height = 1;
            var hits = svg.getIntersectionList(sr, null);
            if (hits.length) {
                target = hits[hits.length - 1];
            }
        }
        if (!target) {
            return null;
        }
        while (target.parentNode && target != svg.parentNode && !target.raphael) {
            target = target.parentNode;
        }
        target == paper.canvas.parentNode && (target = svg);
        target = target && target.raphael ? paper.getById(target.raphaelid) : null;
        return target;
    };

    /*\
     * Paper.getElementsByBBox
     [ method ]
     **
     * Returns set of elements that have an intersecting bounding box
     **
     > Parameters
     **
     - bbox (object) bbox to check with
     = (object) @Set
     \*/
    paperproto.getElementsByBBox = function (bbox) {
        var set = this.set();
        this.forEach(function (el) {
            if (R.isBBoxIntersect(el.getBBox(), bbox)) {
                set.push(el);
            }
        });
        return set;
    };

    /*\
     * Paper.getById
     [ method ]
     **
     * Returns you element by its internal ID.
     **
     > Parameters
     **
     - id (number) id
     = (object) Raphaël element object
    \*/
    paperproto.getById = function (id) {
        var bot = this.bottom;
        while (bot) {
            if (bot.id == id) {
                return bot;
            }
            bot = bot.next;
        }
        return null;
    };
    /*\
     * Paper.forEach
     [ method ]
     **
     * Executes given function for each element on the paper
     *
     * If callback function returns `false` it will stop loop running.
     **
     > Parameters
     **
     - callback (function) function to run
     - thisArg (object) context object for the callback
     = (object) Paper object
     > Usage
     | paper.forEach(function (el) {
     |     el.attr({ stroke: "blue" });
     | });
    \*/
    paperproto.forEach = function (callback, thisArg) {
        var bot = this.bottom;
        while (bot) {
            if (callback.call(thisArg, bot) === false) {
                return this;
            }
            bot = bot.next;
        }
        return this;
    };
    /*\
     * Paper.getElementsByPoint
     [ method ]
     **
     * Returns set of elements that have common point inside
     **
     > Parameters
     **
     - x (number) x coordinate of the point
     - y (number) y coordinate of the point
     = (object) @Set
    \*/
    paperproto.getElementsByPoint = function (x, y) {
        var set = this.set();
        this.forEach(function (el) {
            if (el.isPointInside(x, y)) {
                set.push(el);
            }
        });
        return set;
    };
    function x_y() {
        return this.x + S + this.y;
    }
    function x_y_w_h() {
        return this.x + S + this.y + S + this.width + " \xd7 " + this.height;
    }
    /*\
     * Element.isPointInside
     [ method ]
     **
     * Determine if given point is inside this element’s shape
     **
     > Parameters
     **
     - x (number) x coordinate of the point
     - y (number) y coordinate of the point
     = (boolean) `true` if point inside the shape
    \*/
    elproto.isPointInside = function (x, y) {
        var rp = this.realPath = getPath[this.type](this);
        if (this.attr('transform') && this.attr('transform').length) {
            rp = R.transformPath(rp, this.attr('transform'));
        }
        return R.isPointInsidePath(rp, x, y);
    };
    /*\
     * Element.getBBox
     [ method ]
     **
     * Return bounding box for a given element
     **
     > Parameters
     **
     - isWithoutTransform (boolean) flag, `true` if you want to have bounding box before transformations. Default is `false`.
     = (object) Bounding box object:
     o {
     o     x: (number) top left corner x
     o     y: (number) top left corner y
     o     x2: (number) bottom right corner x
     o     y2: (number) bottom right corner y
     o     width: (number) width
     o     height: (number) height
     o }
    \*/
    elproto.getBBox = function (isWithoutTransform) {
        if (this.removed) {
            return {};
        }
        var _ = this._;
        if (isWithoutTransform) {
            if (_.dirty || !_.bboxwt) {
                this.realPath = getPath[this.type](this);
                _.bboxwt = pathDimensions(this.realPath);
                _.bboxwt.toString = x_y_w_h;
                _.dirty = 0;
            }
            return _.bboxwt;
        }
        if (_.dirty || _.dirtyT || !_.bbox) {
            if (_.dirty || !this.realPath) {
                _.bboxwt = 0;
                this.realPath = getPath[this.type](this);
            }
            _.bbox = pathDimensions(mapPath(this.realPath, this.matrix));
            _.bbox.toString = x_y_w_h;
            _.dirty = _.dirtyT = 0;
        }
        return _.bbox;
    };
    /*\
     * Element.clone
     [ method ]
     **
     = (object) clone of a given element
     **
    \*/
    elproto.clone = function () {
        if (this.removed) {
            return null;
        }
        var out = this.paper[this.type]().attr(this.attr());
        this.__set__ && this.__set__.push(out);
        return out;
    };
    /*\
     * Element.glow
     [ method ]
     **
     * Return set of elements that create glow-like effect around given element. See @Paper.set.
     *
     * Note: Glow is not connected to the element. If you change element attributes it won’t adjust itself.
     **
     > Parameters
     **
     - glow (object) #optional parameters object with all properties optional:
     o {
     o     width (number) size of the glow, default is `10`
     o     fill (boolean) will it be filled, default is `false`
     o     opacity (number) opacity, default is `0.5`
     o     offsetx (number) horizontal offset, default is `0`
     o     offsety (number) vertical offset, default is `0`
     o     color (string) glow colour, default is `black`
     o }
     = (object) @Paper.set of elements that represents glow
    \*/
    elproto.glow = function (glow) {
        if (this.type == "text") {
            return null;
        }
        glow = glow || {};
        var s = {
            width: (glow.width || 10) + (+this.attr("stroke-width") || 1),
            fill: glow.fill || false,
            opacity: glow.opacity || .5,
            offsetx: glow.offsetx || 0,
            offsety: glow.offsety || 0,
            color: glow.color || "#000"
        },
            c = s.width / 2,
            r = this.paper,
            out = r.set(),
            path = this.realPath || getPath[this.type](this);
        path = this.matrix ? mapPath(path, this.matrix) : path;
        for (var i = 1; i < c + 1; i++) {
            out.push(r.path(path).attr({
                stroke: s.color,
                fill: s.fill ? s.color : "none",
                "stroke-linejoin": "round",
                "stroke-linecap": "round",
                "stroke-width": +(s.width / c * i).toFixed(3),
                opacity: +(s.opacity / c).toFixed(3)
            }));
        }
        return out.insertBefore(this).translate(s.offsetx, s.offsety);
    };
    var curveslengths = {},
    getPointAtSegmentLength = function (p1x, p1y, c1x, c1y, c2x, c2y, p2x, p2y, length) {
        if (length == null) {
            return bezlen(p1x, p1y, c1x, c1y, c2x, c2y, p2x, p2y);
        } else {
            return R.findDotsAtSegment(p1x, p1y, c1x, c1y, c2x, c2y, p2x, p2y, getTatLen(p1x, p1y, c1x, c1y, c2x, c2y, p2x, p2y, length));
        }
    },
    getLengthFactory = function (istotal, subpath) {
        return function (path, length, onlystart) {
            path = path2curve(path);
            var x, y, p, l, sp = "", subpaths = {}, point,
                len = 0;
            for (var i = 0, ii = path.length; i < ii; i++) {
                p = path[i];
                if (p[0] == "M") {
                    x = +p[1];
                    y = +p[2];
                } else {
                    l = getPointAtSegmentLength(x, y, p[1], p[2], p[3], p[4], p[5], p[6]);
                    if (len + l > length) {
                        if (subpath && !subpaths.start) {
                            point = getPointAtSegmentLength(x, y, p[1], p[2], p[3], p[4], p[5], p[6], length - len);
                            sp += ["C" + point.start.x, point.start.y, point.m.x, point.m.y, point.x, point.y];
                            if (onlystart) {return sp;}
                            subpaths.start = sp;
                            sp = ["M" + point.x, point.y + "C" + point.n.x, point.n.y, point.end.x, point.end.y, p[5], p[6]].join();
                            len += l;
                            x = +p[5];
                            y = +p[6];
                            continue;
                        }
                        if (!istotal && !subpath) {
                            point = getPointAtSegmentLength(x, y, p[1], p[2], p[3], p[4], p[5], p[6], length - len);
                            return {x: point.x, y: point.y, alpha: point.alpha};
                        }
                    }
                    len += l;
                    x = +p[5];
                    y = +p[6];
                }
                sp += p.shift() + p;
            }
            subpaths.end = sp;
            point = istotal ? len : subpath ? subpaths : R.findDotsAtSegment(x, y, p[0], p[1], p[2], p[3], p[4], p[5], 1);
            point.alpha && (point = {x: point.x, y: point.y, alpha: point.alpha});
            return point;
        };
    };
    var getTotalLength = getLengthFactory(1),
        getPointAtLength = getLengthFactory(),
        getSubpathsAtLength = getLengthFactory(0, 1);
    /*\
     * Raphael.getTotalLength
     [ method ]
     **
     * Returns length of the given path in pixels.
     **
     > Parameters
     **
     - path (string) SVG path string.
     **
     = (number) length.
    \*/
    R.getTotalLength = getTotalLength;
    /*\
     * Raphael.getPointAtLength
     [ method ]
     **
     * Return coordinates of the point located at the given length on the given path.
     **
     > Parameters
     **
     - path (string) SVG path string
     - length (number)
     **
     = (object) representation of the point:
     o {
     o     x: (number) x coordinate
     o     y: (number) y coordinate
     o     alpha: (number) angle of derivative
     o }
    \*/
    R.getPointAtLength = getPointAtLength;
    /*\
     * Raphael.getSubpath
     [ method ]
     **
     * Return subpath of a given path from given length to given length.
     **
     > Parameters
     **
     - path (string) SVG path string
     - from (number) position of the start of the segment
     - to (number) position of the end of the segment
     **
     = (string) pathstring for the segment
    \*/
    R.getSubpath = function (path, from, to) {
        if (this.getTotalLength(path) - to < 1e-6) {
            return getSubpathsAtLength(path, from).end;
        }
        var a = getSubpathsAtLength(path, to, 1);
        return from ? getSubpathsAtLength(a, from).end : a;
    };
    /*\
     * Element.getTotalLength
     [ method ]
     **
     * Returns length of the path in pixels. Only works for element of “path” type.
     = (number) length.
    \*/
    elproto.getTotalLength = function () {
        var path = this.getPath();
        if (!path) {
            return;
        }

        if (this.node.getTotalLength) {
            return this.node.getTotalLength();
        }

        return getTotalLength(path);
    };
    /*\
     * Element.getPointAtLength
     [ method ]
     **
     * Return coordinates of the point located at the given length on the given path. Only works for element of “path” type.
     **
     > Parameters
     **
     - length (number)
     **
     = (object) representation of the point:
     o {
     o     x: (number) x coordinate
     o     y: (number) y coordinate
     o     alpha: (number) angle of derivative
     o }
    \*/
    elproto.getPointAtLength = function (length) {
        var path = this.getPath();
        if (!path) {
            return;
        }

        return getPointAtLength(path, length);
    };
    /*\
     * Element.getPath
     [ method ]
     **
     * Returns path of the element. Only works for elements of “path” type and simple elements like circle.
     = (object) path
     **
    \*/
    elproto.getPath = function () {
        var path,
            getPath = R._getPath[this.type];
        
        if (this.type == "text" || this.type == "set") {
            return;
        }

        if (getPath) {
            path = getPath(this);
        }

        return path;
    };
    /*\
     * Element.getSubpath
     [ method ]
     **
     * Return subpath of a given element from given length to given length. Only works for element of “path” type.
     **
     > Parameters
     **
     - from (number) position of the start of the segment
     - to (number) position of the end of the segment
     **
     = (string) pathstring for the segment
    \*/
    elproto.getSubpath = function (from, to) {
        var path = this.getPath();
        if (!path) {
            return;
        }

        return R.getSubpath(path, from, to);
    };
    /*\
     * Raphael.easing_formulas
     [ property ]
     **
     * Object that contains easing formulas for animation. You could extend it with your own. By default it has following list of easing:
     # <ul>
     #     <li>“linear”</li>
     #     <li>“&lt;” or “easeIn” or “ease-in”</li>
     #     <li>“>” or “easeOut” or “ease-out”</li>
     #     <li>“&lt;>” or “easeInOut” or “ease-in-out”</li>
     #     <li>“backIn” or “back-in”</li>
     #     <li>“backOut” or “back-out”</li>
     #     <li>“elastic”</li>
     #     <li>“bounce”</li>
     # </ul>
     # <p>See also <a href="http://raphaeljs.com/easing.html">Easing demo</a>.</p>
    \*/
    var ef = R.easing_formulas = {
        linear: function (n) {
            return n;
        },
        "<": function (n) {
            return pow(n, 1.7);
        },
        ">": function (n) {
            return pow(n, .48);
        },
        "<>": function (n) {
            var q = .48 - n / 1.04,
                Q = math.sqrt(.1734 + q * q),
                x = Q - q,
                X = pow(abs(x), 1 / 3) * (x < 0 ? -1 : 1),
                y = -Q - q,
                Y = pow(abs(y), 1 / 3) * (y < 0 ? -1 : 1),
                t = X + Y + .5;
            return (1 - t) * 3 * t * t + t * t * t;
        },
        backIn: function (n) {
            var s = 1.70158;
            return n * n * ((s + 1) * n - s);
        },
        backOut: function (n) {
            n = n - 1;
            var s = 1.70158;
            return n * n * ((s + 1) * n + s) + 1;
        },
        elastic: function (n) {
            if (n == !!n) {
                return n;
            }
            return pow(2, -10 * n) * math.sin((n - .075) * (2 * PI) / .3) + 1;
        },
        bounce: function (n) {
            var s = 7.5625,
                p = 2.75,
                l;
            if (n < (1 / p)) {
                l = s * n * n;
            } else {
                if (n < (2 / p)) {
                    n -= (1.5 / p);
                    l = s * n * n + .75;
                } else {
                    if (n < (2.5 / p)) {
                        n -= (2.25 / p);
                        l = s * n * n + .9375;
                    } else {
                        n -= (2.625 / p);
                        l = s * n * n + .984375;
                    }
                }
            }
            return l;
        }
    };
    ef.easeIn = ef["ease-in"] = ef["<"];
    ef.easeOut = ef["ease-out"] = ef[">"];
    ef.easeInOut = ef["ease-in-out"] = ef["<>"];
    ef["back-in"] = ef.backIn;
    ef["back-out"] = ef.backOut;

    var animationElements = [],
        requestAnimFrame = window.requestAnimationFrame       ||
                           window.webkitRequestAnimationFrame ||
                           window.mozRequestAnimationFrame    ||
                           window.oRequestAnimationFrame      ||
                           window.msRequestAnimationFrame     ||
                           function (callback) {
                               setTimeout(callback, 16);
                           },
        animation = function () {
            var Now = +new Date,
                l = 0;
            for (; l < animationElements.length; l++) {
                var e = animationElements[l];
                if (e.el.removed || e.paused) {
                    continue;
                }
                var time = Now - e.start,
                    ms = e.ms,
                    easing = e.easing,
                    from = e.from,
                    diff = e.diff,
                    to = e.to,
                    t = e.t,
                    that = e.el,
                    set = {},
                    now,
                    init = {},
                    key;
                if (e.initstatus) {
                    time = (e.initstatus * e.anim.top - e.prev) / (e.percent - e.prev) * ms;
                    e.status = e.initstatus;
                    delete e.initstatus;
                    e.stop && animationElements.splice(l--, 1);
                } else {
                    e.status = (e.prev + (e.percent - e.prev) * (time / ms)) / e.anim.top;
                }
                if (time < 0) {
                    continue;
                }
                if (time < ms) {
                    var pos = easing(time / ms);
                    for (var attr in from) if (from[has](attr)) {
                        switch (availableAnimAttrs[attr]) {
                            case nu:
                                now = +from[attr] + pos * ms * diff[attr];
                                break;
                            case "colour":
                                now = "rgb(" + [
                                    upto255(round(from[attr].r + pos * ms * diff[attr].r)),
                                    upto255(round(from[attr].g + pos * ms * diff[attr].g)),
                                    upto255(round(from[attr].b + pos * ms * diff[attr].b))
                                ].join(",") + ")";
                                break;
                            case "path":
                                now = [];
                                for (var i = 0, ii = from[attr].length; i < ii; i++) {
                                    now[i] = [from[attr][i][0]];
                                    for (var j = 1, jj = from[attr][i].length; j < jj; j++) {
                                        now[i][j] = +from[attr][i][j] + pos * ms * diff[attr][i][j];
                                    }
                                    now[i] = now[i].join(S);
                                }
                                now = now.join(S);
                                break;
                            case "transform":
                                if (diff[attr].real) {
                                    now = [];
                                    for (i = 0, ii = from[attr].length; i < ii; i++) {
                                        now[i] = [from[attr][i][0]];
                                        for (j = 1, jj = from[attr][i].length; j < jj; j++) {
                                            now[i][j] = from[attr][i][j] + pos * ms * diff[attr][i][j];
                                        }
                                    }
                                } else {
                                    var get = function (i) {
                                        return +from[attr][i] + pos * ms * diff[attr][i];
                                    };
                                    // now = [["r", get(2), 0, 0], ["t", get(3), get(4)], ["s", get(0), get(1), 0, 0]];
                                    now = [["m", get(0), get(1), get(2), get(3), get(4), get(5)]];
                                }
                                break;
                            case "csv":
                                if (attr == "clip-rect") {
                                    now = [];
                                    i = 4;
                                    while (i--) {
                                        now[i] = +from[attr][i] + pos * ms * diff[attr][i];
                                    }
                                }
                                break;
                            default:
                                var from2 = [][concat](from[attr]);
                                now = [];
                                i = that.paper.customAttributes[attr].length;
                                while (i--) {
                                    now[i] = +from2[i] + pos * ms * diff[attr][i];
                                }
                                break;
                        }
                        set[attr] = now;
                    }
                    that.attr(set);
                    (function (id, that, anim) {
                        setTimeout(function () {
                            eve("raphael.anim.frame." + id, that, anim);
                        });
                    })(that.id, that, e.anim);
                } else {
                    (function(f, el, a) {
                        setTimeout(function() {
                            eve("raphael.anim.frame." + el.id, el, a);
                            eve("raphael.anim.finish." + el.id, el, a);
                            R.is(f, "function") && f.call(el);
                        });
                    })(e.callback, that, e.anim);
                    that.attr(to);
                    animationElements.splice(l--, 1);
                    if (e.repeat > 1 && !e.next) {
                        for (key in to) if (to[has](key)) {
                            init[key] = e.totalOrigin[key];
                        }
                        e.el.attr(init);
                        runAnimation(e.anim, e.el, e.anim.percents[0], null, e.totalOrigin, e.repeat - 1);
                    }
                    if (e.next && !e.stop) {
                        runAnimation(e.anim, e.el, e.next, null, e.totalOrigin, e.repeat);
                    }
                }
            }
            R.svg && that && that.paper && that.paper.safari();
            animationElements.length && requestAnimFrame(animation);
        },
        upto255 = function (color) {
            return color > 255 ? 255 : color < 0 ? 0 : color;
        };
    /*\
     * Element.animateWith
     [ method ]
     **
     * Acts similar to @Element.animate, but ensure that given animation runs in sync with another given element.
     **
     > Parameters
     **
     - el (object) element to sync with
     - anim (object) animation to sync with
     - params (object) #optional final attributes for the element, see also @Element.attr
     - ms (number) #optional number of milliseconds for animation to run
     - easing (string) #optional easing type. Accept on of @Raphael.easing_formulas or CSS format: `cubic&#x2010;bezier(XX,&#160;XX,&#160;XX,&#160;XX)`
     - callback (function) #optional callback function. Will be called at the end of animation.
     * or
     - element (object) element to sync with
     - anim (object) animation to sync with
     - animation (object) #optional animation object, see @Raphael.animation
     **
     = (object) original element
    \*/
    elproto.animateWith = function (el, anim, params, ms, easing, callback) {
        var element = this;
        if (element.removed) {
            callback && callback.call(element);
            return element;
        }
        var a = params instanceof Animation ? params : R.animation(params, ms, easing, callback),
            x, y;
        runAnimation(a, element, a.percents[0], null, element.attr());
        for (var i = 0, ii = animationElements.length; i < ii; i++) {
            if (animationElements[i].anim == anim && animationElements[i].el == el) {
                animationElements[ii - 1].start = animationElements[i].start;
                break;
            }
        }
        return element;
        // 
        // 
        // var a = params ? R.animation(params, ms, easing, callback) : anim,
        //     status = element.status(anim);
        // return this.animate(a).status(a, status * anim.ms / a.ms);
    };
    function CubicBezierAtTime(t, p1x, p1y, p2x, p2y, duration) {
        var cx = 3 * p1x,
            bx = 3 * (p2x - p1x) - cx,
            ax = 1 - cx - bx,
            cy = 3 * p1y,
            by = 3 * (p2y - p1y) - cy,
            ay = 1 - cy - by;
        function sampleCurveX(t) {
            return ((ax * t + bx) * t + cx) * t;
        }
        function solve(x, epsilon) {
            var t = solveCurveX(x, epsilon);
            return ((ay * t + by) * t + cy) * t;
        }
        function solveCurveX(x, epsilon) {
            var t0, t1, t2, x2, d2, i;
            for(t2 = x, i = 0; i < 8; i++) {
                x2 = sampleCurveX(t2) - x;
                if (abs(x2) < epsilon) {
                    return t2;
                }
                d2 = (3 * ax * t2 + 2 * bx) * t2 + cx;
                if (abs(d2) < 1e-6) {
                    break;
                }
                t2 = t2 - x2 / d2;
            }
            t0 = 0;
            t1 = 1;
            t2 = x;
            if (t2 < t0) {
                return t0;
            }
            if (t2 > t1) {
                return t1;
            }
            while (t0 < t1) {
                x2 = sampleCurveX(t2);
                if (abs(x2 - x) < epsilon) {
                    return t2;
                }
                if (x > x2) {
                    t0 = t2;
                } else {
                    t1 = t2;
                }
                t2 = (t1 - t0) / 2 + t0;
            }
            return t2;
        }
        return solve(t, 1 / (200 * duration));
    }
    elproto.onAnimation = function (f) {
        f ? eve.on("raphael.anim.frame." + this.id, f) : eve.unbind("raphael.anim.frame." + this.id);
        return this;
    };
    function Animation(anim, ms) {
        var percents = [],
            newAnim = {};
        this.ms = ms;
        this.times = 1;
        if (anim) {
            for (var attr in anim) if (anim[has](attr)) {
                newAnim[toFloat(attr)] = anim[attr];
                percents.push(toFloat(attr));
            }
            percents.sort(sortByNumber);
        }
        this.anim = newAnim;
        this.top = percents[percents.length - 1];
        this.percents = percents;
    }
    /*\
     * Animation.delay
     [ method ]
     **
     * Creates a copy of existing animation object with given delay.
     **
     > Parameters
     **
     - delay (number) number of ms to pass between animation start and actual animation
     **
     = (object) new altered Animation object
     | var anim = Raphael.animation({cx: 10, cy: 20}, 2e3);
     | circle1.animate(anim); // run the given animation immediately
     | circle2.animate(anim.delay(500)); // run the given animation after 500 ms
    \*/
    Animation.prototype.delay = function (delay) {
        var a = new Animation(this.anim, this.ms);
        a.times = this.times;
        a.del = +delay || 0;
        return a;
    };
    /*\
     * Animation.repeat
     [ method ]
     **
     * Creates a copy of existing animation object with given repetition.
     **
     > Parameters
     **
     - repeat (number) number iterations of animation. For infinite animation pass `Infinity`
     **
     = (object) new altered Animation object
    \*/
    Animation.prototype.repeat = function (times) {
        var a = new Animation(this.anim, this.ms);
        a.del = this.del;
        a.times = math.floor(mmax(times, 0)) || 1;
        return a;
    };
    function runAnimation(anim, element, percent, status, totalOrigin, times) {
        percent = toFloat(percent);
        var params,
            isInAnim,
            isInAnimSet,
            percents = [],
            next,
            prev,
            timestamp,
            ms = anim.ms,
            from = {},
            to = {},
            diff = {};
        if (status) {
            for (i = 0, ii = animationElements.length; i < ii; i++) {
                var e = animationElements[i];
                if (e.el.id == element.id && e.anim == anim) {
                    if (e.percent != percent) {
                        animationElements.splice(i, 1);
                        isInAnimSet = 1;
                    } else {
                        isInAnim = e;
                    }
                    element.attr(e.totalOrigin);
                    break;
                }
            }
        } else {
            status = +to; // NaN
        }
        for (var i = 0, ii = anim.percents.length; i < ii; i++) {
            if (anim.percents[i] == percent || anim.percents[i] > status * anim.top) {
                percent = anim.percents[i];
                prev = anim.percents[i - 1] || 0;
                ms = ms / anim.top * (percent - prev);
                next = anim.percents[i + 1];
                params = anim.anim[percent];
                break;
            } else if (status) {
                element.attr(anim.anim[anim.percents[i]]);
            }
        }
        if (!params) {
            return;
        }
        if (!isInAnim) {
            for (var attr in params) if (params[has](attr)) {
                if (availableAnimAttrs[has](attr) || element.paper.customAttributes[has](attr)) {
                    from[attr] = element.attr(attr);
                    (from[attr] == null) && (from[attr] = availableAttrs[attr]);
                    to[attr] = params[attr];
                    switch (availableAnimAttrs[attr]) {
                        case nu:
                            diff[attr] = (to[attr] - from[attr]) / ms;
                            break;
                        case "colour":
                            from[attr] = R.getRGB(from[attr]);
                            var toColour = R.getRGB(to[attr]);
                            diff[attr] = {
                                r: (toColour.r - from[attr].r) / ms,
                                g: (toColour.g - from[attr].g) / ms,
                                b: (toColour.b - from[attr].b) / ms
                            };
                            break;
                        case "path":
                            var pathes = path2curve(from[attr], to[attr]),
                                toPath = pathes[1];
                            from[attr] = pathes[0];
                            diff[attr] = [];
                            for (i = 0, ii = from[attr].length; i < ii; i++) {
                                diff[attr][i] = [0];
                                for (var j = 1, jj = from[attr][i].length; j < jj; j++) {
                                    diff[attr][i][j] = (toPath[i][j] - from[attr][i][j]) / ms;
                                }
                            }
                            break;
                        case "transform":
                            var _ = element._,
                                eq = equaliseTransform(_[attr], to[attr]);
                            if (eq) {
                                from[attr] = eq.from;
                                to[attr] = eq.to;
                                diff[attr] = [];
                                diff[attr].real = true;
                                for (i = 0, ii = from[attr].length; i < ii; i++) {
                                    diff[attr][i] = [from[attr][i][0]];
                                    for (j = 1, jj = from[attr][i].length; j < jj; j++) {
                                        diff[attr][i][j] = (to[attr][i][j] - from[attr][i][j]) / ms;
                                    }
                                }
                            } else {
                                var m = (element.matrix || new Matrix),
                                    to2 = {
                                        _: {transform: _.transform},
                                        getBBox: function () {
                                            return element.getBBox(1);
                                        }
                                    };
                                from[attr] = [
                                    m.a,
                                    m.b,
                                    m.c,
                                    m.d,
                                    m.e,
                                    m.f
                                ];
                                extractTransform(to2, to[attr]);
                                to[attr] = to2._.transform;
                                diff[attr] = [
                                    (to2.matrix.a - m.a) / ms,
                                    (to2.matrix.b - m.b) / ms,
                                    (to2.matrix.c - m.c) / ms,
                                    (to2.matrix.d - m.d) / ms,
                                    (to2.matrix.e - m.e) / ms,
                                    (to2.matrix.f - m.f) / ms
                                ];
                                // from[attr] = [_.sx, _.sy, _.deg, _.dx, _.dy];
                                // var to2 = {_:{}, getBBox: function () { return element.getBBox(); }};
                                // extractTransform(to2, to[attr]);
                                // diff[attr] = [
                                //     (to2._.sx - _.sx) / ms,
                                //     (to2._.sy - _.sy) / ms,
                                //     (to2._.deg - _.deg) / ms,
                                //     (to2._.dx - _.dx) / ms,
                                //     (to2._.dy - _.dy) / ms
                                // ];
                            }
                            break;
                        case "csv":
                            var values = Str(params[attr])[split](separator),
                                from2 = Str(from[attr])[split](separator);
                            if (attr == "clip-rect") {
                                from[attr] = from2;
                                diff[attr] = [];
                                i = from2.length;
                                while (i--) {
                                    diff[attr][i] = (values[i] - from[attr][i]) / ms;
                                }
                            }
                            to[attr] = values;
                            break;
                        default:
                            values = [][concat](params[attr]);
                            from2 = [][concat](from[attr]);
                            diff[attr] = [];
                            i = element.paper.customAttributes[attr].length;
                            while (i--) {
                                diff[attr][i] = ((values[i] || 0) - (from2[i] || 0)) / ms;
                            }
                            break;
                    }
                }
            }
            var easing = params.easing,
                easyeasy = R.easing_formulas[easing];
            if (!easyeasy) {
                easyeasy = Str(easing).match(bezierrg);
                if (easyeasy && easyeasy.length == 5) {
                    var curve = easyeasy;
                    easyeasy = function (t) {
                        return CubicBezierAtTime(t, +curve[1], +curve[2], +curve[3], +curve[4], ms);
                    };
                } else {
                    easyeasy = pipe;
                }
            }
            timestamp = params.start || anim.start || +new Date;
            e = {
                anim: anim,
                percent: percent,
                timestamp: timestamp,
                start: timestamp + (anim.del || 0),
                status: 0,
                initstatus: status || 0,
                stop: false,
                ms: ms,
                easing: easyeasy,
                from: from,
                diff: diff,
                to: to,
                el: element,
                callback: params.callback,
                prev: prev,
                next: next,
                repeat: times || anim.times,
                origin: element.attr(),
                totalOrigin: totalOrigin
            };
            animationElements.push(e);
            if (status && !isInAnim && !isInAnimSet) {
                e.stop = true;
                e.start = new Date - ms * status;
                if (animationElements.length == 1) {
                    return animation();
                }
            }
            if (isInAnimSet) {
                e.start = new Date - e.ms * status;
            }
            animationElements.length == 1 && requestAnimFrame(animation);
        } else {
            isInAnim.initstatus = status;
            isInAnim.start = new Date - isInAnim.ms * status;
        }
        eve("raphael.anim.start." + element.id, element, anim);
    }
    /*\
     * Raphael.animation
     [ method ]
     **
     * Creates an animation object that can be passed to the @Element.animate or @Element.animateWith methods.
     * See also @Animation.delay and @Animation.repeat methods.
     **
     > Parameters
     **
     - params (object) final attributes for the element, see also @Element.attr
     - ms (number) number of milliseconds for animation to run
     - easing (string) #optional easing type. Accept one of @Raphael.easing_formulas or CSS format: `cubic&#x2010;bezier(XX,&#160;XX,&#160;XX,&#160;XX)`
     - callback (function) #optional callback function. Will be called at the end of animation.
     **
     = (object) @Animation
    \*/
    R.animation = function (params, ms, easing, callback) {
        if (params instanceof Animation) {
            return params;
        }
        if (R.is(easing, "function") || !easing) {
            callback = callback || easing || null;
            easing = null;
        }
        params = Object(params);
        ms = +ms || 0;
        var p = {},
            json,
            attr;
        for (attr in params) if (params[has](attr) && toFloat(attr) != attr && toFloat(attr) + "%" != attr) {
            json = true;
            p[attr] = params[attr];
        }
        if (!json) {
            return new Animation(params, ms);
        } else {
            easing && (p.easing = easing);
            callback && (p.callback = callback);
            return new Animation({100: p}, ms);
        }
    };
    /*\
     * Element.animate
     [ method ]
     **
     * Creates and starts animation for given element.
     **
     > Parameters
     **
     - params (object) final attributes for the element, see also @Element.attr
     - ms (number) number of milliseconds for animation to run
     - easing (string) #optional easing type. Accept one of @Raphael.easing_formulas or CSS format: `cubic&#x2010;bezier(XX,&#160;XX,&#160;XX,&#160;XX)`
     - callback (function) #optional callback function. Will be called at the end of animation.
     * or
     - animation (object) animation object, see @Raphael.animation
     **
     = (object) original element
    \*/
    elproto.animate = function (params, ms, easing, callback) {
        var element = this;
        if (element.removed) {
            callback && callback.call(element);
            return element;
        }
        var anim = params instanceof Animation ? params : R.animation(params, ms, easing, callback);
        runAnimation(anim, element, anim.percents[0], null, element.attr());
        return element;
    };
    /*\
     * Element.setTime
     [ method ]
     **
     * Sets the status of animation of the element in milliseconds. Similar to @Element.status method.
     **
     > Parameters
     **
     - anim (object) animation object
     - value (number) number of milliseconds from the beginning of the animation
     **
     = (object) original element if `value` is specified
     * Note, that during animation following events are triggered:
     *
     * On each animation frame event `anim.frame.<id>`, on start `anim.start.<id>` and on end `anim.finish.<id>`.
    \*/
    elproto.setTime = function (anim, value) {
        if (anim && value != null) {
            this.status(anim, mmin(value, anim.ms) / anim.ms);
        }
        return this;
    };
    /*\
     * Element.status
     [ method ]
     **
     * Gets or sets the status of animation of the element.
     **
     > Parameters
     **
     - anim (object) #optional animation object
     - value (number) #optional 0 – 1. If specified, method works like a setter and sets the status of a given animation to the value. This will cause animation to jump to the given position.
     **
     = (number) status
     * or
     = (array) status if `anim` is not specified. Array of objects in format:
     o {
     o     anim: (object) animation object
     o     status: (number) status
     o }
     * or
     = (object) original element if `value` is specified
    \*/
    elproto.status = function (anim, value) {
        var out = [],
            i = 0,
            len,
            e;
        if (value != null) {
            runAnimation(anim, this, -1, mmin(value, 1));
            return this;
        } else {
            len = animationElements.length;
            for (; i < len; i++) {
                e = animationElements[i];
                if (e.el.id == this.id && (!anim || e.anim == anim)) {
                    if (anim) {
                        return e.status;
                    }
                    out.push({
                        anim: e.anim,
                        status: e.status
                    });
                }
            }
            if (anim) {
                return 0;
            }
            return out;
        }
    };
    /*\
     * Element.pause
     [ method ]
     **
     * Stops animation of the element with ability to resume it later on.
     **
     > Parameters
     **
     - anim (object) #optional animation object
     **
     = (object) original element
    \*/
    elproto.pause = function (anim) {
        for (var i = 0; i < animationElements.length; i++) if (animationElements[i].el.id == this.id && (!anim || animationElements[i].anim == anim)) {
            if (eve("raphael.anim.pause." + this.id, this, animationElements[i].anim) !== false) {
                animationElements[i].paused = true;
            }
        }
        return this;
    };
    /*\
     * Element.resume
     [ method ]
     **
     * Resumes animation if it was paused with @Element.pause method.
     **
     > Parameters
     **
     - anim (object) #optional animation object
     **
     = (object) original element
    \*/
    elproto.resume = function (anim) {
        for (var i = 0; i < animationElements.length; i++) if (animationElements[i].el.id == this.id && (!anim || animationElements[i].anim == anim)) {
            var e = animationElements[i];
            if (eve("raphael.anim.resume." + this.id, this, e.anim) !== false) {
                delete e.paused;
                this.status(e.anim, e.status);
            }
        }
        return this;
    };
    /*\
     * Element.stop
     [ method ]
     **
     * Stops animation of the element.
     **
     > Parameters
     **
     - anim (object) #optional animation object
     **
     = (object) original element
    \*/
    elproto.stop = function (anim) {
        for (var i = 0; i < animationElements.length; i++) if (animationElements[i].el.id == this.id && (!anim || animationElements[i].anim == anim)) {
            if (eve("raphael.anim.stop." + this.id, this, animationElements[i].anim) !== false) {
                animationElements.splice(i--, 1);
            }
        }
        return this;
    };
    function stopAnimation(paper) {
        for (var i = 0; i < animationElements.length; i++) if (animationElements[i].el.paper == paper) {
            animationElements.splice(i--, 1);
        }
    }
    eve.on("raphael.remove", stopAnimation);
    eve.on("raphael.clear", stopAnimation);
    elproto.toString = function () {
        return "Rapha\xebl\u2019s object";
    };

    // Set
    var Set = function (items) {
        this.items = [];
        this.length = 0;
        this.type = "set";
        if (items) {
            for (var i = 0, ii = items.length; i < ii; i++) {
                if (items[i] && (items[i].constructor == elproto.constructor || items[i].constructor == Set)) {
                    this[this.items.length] = this.items[this.items.length] = items[i];
                    this.length++;
                }
            }
        }
    },
    setproto = Set.prototype;
    /*\
     * Set.push
     [ method ]
     **
     * Adds each argument to the current set.
     = (object) original element
    \*/
    setproto.push = function () {
        var item,
            len;
        for (var i = 0, ii = arguments.length; i < ii; i++) {
            item = arguments[i];
            if (item && (item.constructor == elproto.constructor || item.constructor == Set)) {
                len = this.items.length;
                this[len] = this.items[len] = item;
                this.length++;
            }
        }
        return this;
    };
    /*\
     * Set.pop
     [ method ]
     **
     * Removes last element and returns it.
     = (object) element
    \*/
    setproto.pop = function () {
        this.length && delete this[this.length--];
        return this.items.pop();
    };
    /*\
     * Set.forEach
     [ method ]
     **
     * Executes given function for each element in the set.
     *
     * If function returns `false` it will stop loop running.
     **
     > Parameters
     **
     - callback (function) function to run
     - thisArg (object) context object for the callback
     = (object) Set object
    \*/
    setproto.forEach = function (callback, thisArg) {
        for (var i = 0, ii = this.items.length; i < ii; i++) {
            if (callback.call(thisArg, this.items[i], i) === false) {
                return this;
            }
        }
        return this;
    };
    for (var method in elproto) if (elproto[has](method)) {
        setproto[method] = (function (methodname) {
            return function () {
                var arg = arguments;
                return this.forEach(function (el) {
                    el[methodname][apply](el, arg);
                });
            };
        })(method);
    }
    setproto.attr = function (name, value) {
        if (name && R.is(name, array) && R.is(name[0], "object")) {
            for (var j = 0, jj = name.length; j < jj; j++) {
                this.items[j].attr(name[j]);
            }
        } else {
            for (var i = 0, ii = this.items.length; i < ii; i++) {
                this.items[i].attr(name, value);
            }
        }
        return this;
    };
    /*\
     * Set.clear
     [ method ]
     **
     * Removeds all elements from the set
    \*/
    setproto.clear = function () {
        while (this.length) {
            this.pop();
        }
    };
    /*\
     * Set.splice
     [ method ]
     **
     * Removes given element from the set
     **
     > Parameters
     **
     - index (number) position of the deletion
     - count (number) number of element to remove
     - insertion… (object) #optional elements to insert
     = (object) set elements that were deleted
    \*/
    setproto.splice = function (index, count, insertion) {
        index = index < 0 ? mmax(this.length + index, 0) : index;
        count = mmax(0, mmin(this.length - index, count));
        var tail = [],
            todel = [],
            args = [],
            i;
        for (i = 2; i < arguments.length; i++) {
            args.push(arguments[i]);
        }
        for (i = 0; i < count; i++) {
            todel.push(this[index + i]);
        }
        for (; i < this.length - index; i++) {
            tail.push(this[index + i]);
        }
        var arglen = args.length;
        for (i = 0; i < arglen + tail.length; i++) {
            this.items[index + i] = this[index + i] = i < arglen ? args[i] : tail[i - arglen];
        }
        i = this.items.length = this.length -= count - arglen;
        while (this[i]) {
            delete this[i++];
        }
        return new Set(todel);
    };
    /*\
     * Set.exclude
     [ method ]
     **
     * Removes given element from the set
     **
     > Parameters
     **
     - element (object) element to remove
     = (boolean) `true` if object was found & removed from the set
    \*/
    setproto.exclude = function (el) {
        for (var i = 0, ii = this.length; i < ii; i++) if (this[i] == el) {
            this.splice(i, 1);
            return true;
        }
    };
    setproto.animate = function (params, ms, easing, callback) {
        (R.is(easing, "function") || !easing) && (callback = easing || null);
        var len = this.items.length,
            i = len,
            item,
            set = this,
            collector;
        if (!len) {
            return this;
        }
        callback && (collector = function () {
            !--len && callback.call(set);
        });
        easing = R.is(easing, string) ? easing : collector;
        var anim = R.animation(params, ms, easing, collector);
        item = this.items[--i].animate(anim);
        while (i--) {
            this.items[i] && !this.items[i].removed && this.items[i].animateWith(item, anim, anim);
            (this.items[i] && !this.items[i].removed) || len--;
        }
        return this;
    };
    setproto.insertAfter = function (el) {
        var i = this.items.length;
        while (i--) {
            this.items[i].insertAfter(el);
        }
        return this;
    };
    setproto.getBBox = function () {
        var x = [],
            y = [],
            x2 = [],
            y2 = [];
        for (var i = this.items.length; i--;) if (!this.items[i].removed) {
            var box = this.items[i].getBBox();
            x.push(box.x);
            y.push(box.y);
            x2.push(box.x + box.width);
            y2.push(box.y + box.height);
        }
        x = mmin[apply](0, x);
        y = mmin[apply](0, y);
        x2 = mmax[apply](0, x2);
        y2 = mmax[apply](0, y2);
        return {
            x: x,
            y: y,
            x2: x2,
            y2: y2,
            width: x2 - x,
            height: y2 - y
        };
    };
    setproto.clone = function (s) {
        s = this.paper.set();
        for (var i = 0, ii = this.items.length; i < ii; i++) {
            s.push(this.items[i].clone());
        }
        return s;
    };
    setproto.toString = function () {
        return "Rapha\xebl\u2018s set";
    };

    setproto.glow = function(glowConfig) {
        var ret = this.paper.set();
        this.forEach(function(shape, index){
            var g = shape.glow(glowConfig);
            if(g != null){
                g.forEach(function(shape2, index2){
                    ret.push(shape2);
                });
            }
        });
        return ret;
    };


    /*\
     * Set.isPointInside
     [ method ]
     **
     * Determine if given point is inside this set’s elements
     **
     > Parameters
     **
     - x (number) x coordinate of the point
     - y (number) y coordinate of the point
     = (boolean) `true` if point is inside any of the set's elements
     \*/
    setproto.isPointInside = function (x, y) {
        var isPointInside = false;
        this.forEach(function (el) {
            if (el.isPointInside(x, y)) {
                console.log('runned');
                isPointInside = true;
                return false; // stop loop
            }
        });
        return isPointInside;
    };

    /*\
     * Raphael.registerFont
     [ method ]
     **
     * Adds given font to the registered set of fonts for Raphaël. Should be used as an internal call from within Cufón’s font file.
     * Returns original parameter, so it could be used with chaining.
     # <a href="http://wiki.github.com/sorccu/cufon/about">More about Cufón and how to convert your font form TTF, OTF, etc to JavaScript file.</a>
     **
     > Parameters
     **
     - font (object) the font to register
     = (object) the font you passed in
     > Usage
     | Cufon.registerFont(Raphael.registerFont({…}));
    \*/
    R.registerFont = function (font) {
        if (!font.face) {
            return font;
        }
        this.fonts = this.fonts || {};
        var fontcopy = {
                w: font.w,
                face: {},
                glyphs: {}
            },
            family = font.face["font-family"];
        for (var prop in font.face) if (font.face[has](prop)) {
            fontcopy.face[prop] = font.face[prop];
        }
        if (this.fonts[family]) {
            this.fonts[family].push(fontcopy);
        } else {
            this.fonts[family] = [fontcopy];
        }
        if (!font.svg) {
            fontcopy.face["units-per-em"] = toInt(font.face["units-per-em"], 10);
            for (var glyph in font.glyphs) if (font.glyphs[has](glyph)) {
                var path = font.glyphs[glyph];
                fontcopy.glyphs[glyph] = {
                    w: path.w,
                    k: {},
                    d: path.d && "M" + path.d.replace(/[mlcxtrv]/g, function (command) {
                            return {l: "L", c: "C", x: "z", t: "m", r: "l", v: "c"}[command] || "M";
                        }) + "z"
                };
                if (path.k) {
                    for (var k in path.k) if (path[has](k)) {
                        fontcopy.glyphs[glyph].k[k] = path.k[k];
                    }
                }
            }
        }
        return font;
    };
    /*\
     * Paper.getFont
     [ method ]
     **
     * Finds font object in the registered fonts by given parameters. You could specify only one word from the font name, like “Myriad” for “Myriad Pro”.
     **
     > Parameters
     **
     - family (string) font family name or any word from it
     - weight (string) #optional font weight
     - style (string) #optional font style
     - stretch (string) #optional font stretch
     = (object) the font object
     > Usage
     | paper.print(100, 100, "Test string", paper.getFont("Times", 800), 30);
    \*/
    paperproto.getFont = function (family, weight, style, stretch) {
        stretch = stretch || "normal";
        style = style || "normal";
        weight = +weight || {normal: 400, bold: 700, lighter: 300, bolder: 800}[weight] || 400;
        if (!R.fonts) {
            return;
        }
        var font = R.fonts[family];
        if (!font) {
            var name = new RegExp("(^|\\s)" + family.replace(/[^\w\d\s+!~.:_-]/g, E) + "(\\s|$)", "i");
            for (var fontName in R.fonts) if (R.fonts[has](fontName)) {
                if (name.test(fontName)) {
                    font = R.fonts[fontName];
                    break;
                }
            }
        }
        var thefont;
        if (font) {
            for (var i = 0, ii = font.length; i < ii; i++) {
                thefont = font[i];
                if (thefont.face["font-weight"] == weight && (thefont.face["font-style"] == style || !thefont.face["font-style"]) && thefont.face["font-stretch"] == stretch) {
                    break;
                }
            }
        }
        return thefont;
    };
    /*\
     * Paper.print
     [ method ]
     **
     * Creates path that represent given text written using given font at given position with given size.
     * Result of the method is path element that contains whole text as a separate path.
     **
     > Parameters
     **
     - x (number) x position of the text
     - y (number) y position of the text
     - string (string) text to print
     - font (object) font object, see @Paper.getFont
     - size (number) #optional size of the font, default is `16`
     - origin (string) #optional could be `"baseline"` or `"middle"`, default is `"middle"`
     - letter_spacing (number) #optional number in range `-1..1`, default is `0`
     - line_spacing (number) #optional number in range `1..3`, default is `1`
     = (object) resulting path element, which consist of all letters
     > Usage
     | var txt = r.print(10, 50, "print", r.getFont("Museo"), 30).attr({fill: "#fff"});
    \*/
    paperproto.print = function (x, y, string, font, size, origin, letter_spacing, line_spacing) {
        origin = origin || "middle"; // baseline|middle
        letter_spacing = mmax(mmin(letter_spacing || 0, 1), -1);
        line_spacing = mmax(mmin(line_spacing || 1, 3), 1);
        var letters = Str(string)[split](E),
            shift = 0,
            notfirst = 0,
            path = E,
            scale;
        R.is(font, "string") && (font = this.getFont(font));
        if (font) {
            scale = (size || 16) / font.face["units-per-em"];
            var bb = font.face.bbox[split](separator),
                top = +bb[0],
                lineHeight = bb[3] - bb[1],
                shifty = 0,
                height = +bb[1] + (origin == "baseline" ? lineHeight + (+font.face.descent) : lineHeight / 2);
            for (var i = 0, ii = letters.length; i < ii; i++) {
                if (letters[i] == "\n") {
                    shift = 0;
                    curr = 0;
                    notfirst = 0;
                    shifty += lineHeight * line_spacing;
                } else {
                    var prev = notfirst && font.glyphs[letters[i - 1]] || {},
                        curr = font.glyphs[letters[i]];
                    shift += notfirst ? (prev.w || font.w) + (prev.k && prev.k[letters[i]] || 0) + (font.w * letter_spacing) : 0;
                    notfirst = 1;
                }
                if (curr && curr.d) {
                    path += R.transformPath(curr.d, ["t", shift * scale, shifty * scale, "s", scale, scale, top, height, "t", (x - top) / scale, (y - height) / scale]);
                }
            }
        }
        return this.path(path).attr({
            fill: "#000",
            stroke: "none"
        });
    };

    /*\
     * Paper.add
     [ method ]
     **
     * Imports elements in JSON array in format `{type: type, <attributes>}`
     **
     > Parameters
     **
     - json (array)
     = (object) resulting set of imported elements
     > Usage
     | paper.add([
     |     {
     |         type: "circle",
     |         cx: 10,
     |         cy: 10,
     |         r: 5
     |     },
     |     {
     |         type: "rect",
     |         x: 10,
     |         y: 10,
     |         width: 10,
     |         height: 10,
     |         fill: "#fc0"
     |     }
     | ]);
    \*/
    paperproto.add = function (json) {
        if (R.is(json, "array")) {
            var res = this.set(),
                i = 0,
                ii = json.length,
                j;
            for (; i < ii; i++) {
                j = json[i] || {};
                elements[has](j.type) && res.push(this[j.type]().attr(j));
            }
        }
        return res;
    };

    /*\
     * Raphael.format
     [ method ]
     **
     * Simple format function. Replaces construction of type “`{<number>}`” to the corresponding argument.
     **
     > Parameters
     **
     - token (string) string to format
     - … (string) rest of arguments will be treated as parameters for replacement
     = (string) formated string
     > Usage
     | var x = 10,
     |     y = 20,
     |     width = 40,
     |     height = 50;
     | // this will draw a rectangular shape equivalent to "M10,20h40v50h-40z"
     | paper.path(Raphael.format("M{0},{1}h{2}v{3}h{4}z", x, y, width, height, -width));
    \*/
    R.format = function (token, params) {
        var args = R.is(params, array) ? [0][concat](params) : arguments;
        token && R.is(token, string) && args.length - 1 && (token = token.replace(formatrg, function (str, i) {
            return args[++i] == null ? E : args[i];
        }));
        return token || E;
    };
    /*\
     * Raphael.fullfill
     [ method ]
     **
     * A little bit more advanced format function than @Raphael.format. Replaces construction of type “`{<name>}`” to the corresponding argument.
     **
     > Parameters
     **
     - token (string) string to format
     - json (object) object which properties will be used as a replacement
     = (string) formated string
     > Usage
     | // this will draw a rectangular shape equivalent to "M10,20h40v50h-40z"
     | paper.path(Raphael.fullfill("M{x},{y}h{dim.width}v{dim.height}h{dim['negative width']}z", {
     |     x: 10,
     |     y: 20,
     |     dim: {
     |         width: 40,
     |         height: 50,
     |         "negative width": -40
     |     }
     | }));
    \*/
    R.fullfill = (function () {
        var tokenRegex = /\{([^\}]+)\}/g,
            objNotationRegex = /(?:(?:^|\.)(.+?)(?=\[|\.|$|\()|\[('|")(.+?)\2\])(\(\))?/g, // matches .xxxxx or ["xxxxx"] to run over object properties
            replacer = function (all, key, obj) {
                var res = obj;
                key.replace(objNotationRegex, function (all, name, quote, quotedName, isFunc) {
                    name = name || quotedName;
                    if (res) {
                        if (name in res) {
                            res = res[name];
                        }
                        typeof res == "function" && isFunc && (res = res());
                    }
                });
                res = (res == null || res == obj ? all : res) + "";
                return res;
            };
        return function (str, obj) {
            return String(str).replace(tokenRegex, function (all, key) {
                return replacer(all, key, obj);
            });
        };
    })();
    /*\
     * Raphael.ninja
     [ method ]
     **
     * If you want to leave no trace of Raphaël (Well, Raphaël creates only one global variable `Raphael`, but anyway.) You can use `ninja` method.
     * Beware, that in this case plugins could stop working, because they are depending on global variable existance.
     **
     = (object) Raphael object
     > Usage
     | (function (local_raphael) {
     |     var paper = local_raphael(10, 10, 320, 200);
     |     …
     | })(Raphael.ninja());
    \*/
    R.ninja = function () {
        oldRaphael.was ? (g.win.Raphael = oldRaphael.is) : delete Raphael;
        return R;
    };
    /*\
     * Raphael.st
     [ property (object) ]
     **
     * You can add your own method to elements and sets. It is wise to add a set method for each element method
     * you added, so you will be able to call the same method on sets too.
     **
     * See also @Raphael.el.
     > Usage
     | Raphael.el.red = function () {
     |     this.attr({fill: "#f00"});
     | };
     | Raphael.st.red = function () {
     |     this.forEach(function (el) {
     |         el.red();
     |     });
     | };
     | // then use it
     | paper.set(paper.circle(100, 100, 20), paper.circle(110, 100, 20)).red();
    \*/
    R.st = setproto;
    // Firefox <3.6 fix: http://webreflection.blogspot.com/2009/11/195-chars-to-help-lazy-loading.html
    (function (doc, loaded, f) {
        if (doc.readyState == null && doc.addEventListener){
            doc.addEventListener(loaded, f = function () {
                doc.removeEventListener(loaded, f, false);
                doc.readyState = "complete";
            }, false);
            doc.readyState = "loading";
        }
        function isLoaded() {
            (/in/).test(doc.readyState) ? setTimeout(isLoaded, 9) : R.eve("raphael.DOMload");
        }
        isLoaded();
    })(document, "DOMContentLoaded");

    eve.on("raphael.DOMload", function () {
        loaded = true;
    });

// ┌─────────────────────────────────────────────────────────────────────┐ \\
// │ Raphaël - JavaScript Vector Library                                 │ \\
// ├─────────────────────────────────────────────────────────────────────┤ \\
// │ SVG Module                                                          │ \\
// ├─────────────────────────────────────────────────────────────────────┤ \\
// │ Copyright (c) 2008-2011 Dmitry Baranovskiy (http://raphaeljs.com)   │ \\
// │ Copyright (c) 2008-2011 Sencha Labs (http://sencha.com)             │ \\
// │ Licensed under the MIT (http://raphaeljs.com/license.html) license. │ \\
// └─────────────────────────────────────────────────────────────────────┘ \\

(function(){
    if (!R.svg) {
        return;
    }
    var has = "hasOwnProperty",
        Str = String,
        toFloat = parseFloat,
        toInt = parseInt,
        math = Math,
        mmax = math.max,
        abs = math.abs,
        pow = math.pow,
        separator = /[, ]+/,
        eve = R.eve,
        E = "",
        S = " ";
    var xlink = "http://www.w3.org/1999/xlink",
        markers = {
            block: "M5,0 0,2.5 5,5z",
            classic: "M5,0 0,2.5 5,5 3.5,3 3.5,2z",
            diamond: "M2.5,0 5,2.5 2.5,5 0,2.5z",
            open: "M6,1 1,3.5 6,6",
            oval: "M2.5,0A2.5,2.5,0,0,1,2.5,5 2.5,2.5,0,0,1,2.5,0z"
        },
        markerCounter = {};
    R.toString = function () {
        return  "Your browser supports SVG.\nYou are running Rapha\xebl " + this.version;
    };
    var $ = function (el, attr) {
        if (attr) {
            if (typeof el == "string") {
                el = $(el);
            }
            for (var key in attr) if (attr[has](key)) {
                if (key.substring(0, 6) == "xlink:") {
                    el.setAttributeNS(xlink, key.substring(6), Str(attr[key]));
                } else {
                    el.setAttribute(key, Str(attr[key]));
                }
            }
        } else {
            el = R._g.doc.createElementNS("http://www.w3.org/2000/svg", el);
            el.style && (el.style.webkitTapHighlightColor = "rgba(0,0,0,0)");
        }
        return el;
    },
    addGradientFill = function (element, gradient) {
        var type = "linear",
            id = element.id + gradient,
            fx = .5, fy = .5,
            o = element.node,
            SVG = element.paper,
            s = o.style,
            el = R._g.doc.getElementById(id);
        if (!el) {
            gradient = Str(gradient).replace(R._radial_gradient, function (all, _fx, _fy) {
                type = "radial";
                if (_fx && _fy) {
                    fx = toFloat(_fx);
                    fy = toFloat(_fy);
                    var dir = ((fy > .5) * 2 - 1);
                    pow(fx - .5, 2) + pow(fy - .5, 2) > .25 &&
                        (fy = math.sqrt(.25 - pow(fx - .5, 2)) * dir + .5) &&
                        fy != .5 &&
                        (fy = fy.toFixed(5) - 1e-5 * dir);
                }
                return E;
            });
            gradient = gradient.split(/\s*\-\s*/);
            if (type == "linear") {
                var angle = gradient.shift();
                angle = -toFloat(angle);
                if (isNaN(angle)) {
                    return null;
                }
                var vector = [0, 0, math.cos(R.rad(angle)), math.sin(R.rad(angle))],
                    max = 1 / (mmax(abs(vector[2]), abs(vector[3])) || 1);
                vector[2] *= max;
                vector[3] *= max;
                if (vector[2] < 0) {
                    vector[0] = -vector[2];
                    vector[2] = 0;
                }
                if (vector[3] < 0) {
                    vector[1] = -vector[3];
                    vector[3] = 0;
                }
            }
            var dots = R._parseDots(gradient);
            if (!dots) {
                return null;
            }
            id = id.replace(/[\(\)\s,\xb0#]/g, "_");
            
            if (element.gradient && id != element.gradient.id) {
                SVG.defs.removeChild(element.gradient);
                delete element.gradient;
            }

            if (!element.gradient) {
                el = $(type + "Gradient", {id: id});
                element.gradient = el;
                $(el, type == "radial" ? {
                    fx: fx,
                    fy: fy
                } : {
                    x1: vector[0],
                    y1: vector[1],
                    x2: vector[2],
                    y2: vector[3],
                    gradientTransform: element.matrix.invert()
                });
                SVG.defs.appendChild(el);
                for (var i = 0, ii = dots.length; i < ii; i++) {
                    el.appendChild($("stop", {
                        offset: dots[i].offset ? dots[i].offset : i ? "100%" : "0%",
                        "stop-color": dots[i].color || "#fff"
                    }));
                }
            }
        }
        $(o, {
            fill: "url(#" + id + ")",
            opacity: 1,
            "fill-opacity": 1
        });
        s.fill = E;
        s.opacity = 1;
        s.fillOpacity = 1;
        return 1;
    },
    updatePosition = function (o) {
        var bbox = o.getBBox(1);
        $(o.pattern, {patternTransform: o.matrix.invert() + " translate(" + bbox.x + "," + bbox.y + ")"});
    },
    addArrow = function (o, value, isEnd) {
        if (o.type == "path") {
            var values = Str(value).toLowerCase().split("-"),
                p = o.paper,
                se = isEnd ? "end" : "start",
                node = o.node,
                attrs = o.attrs,
                stroke = attrs["stroke-width"],
                i = values.length,
                type = "classic",
                from,
                to,
                dx,
                refX,
                attr,
                w = 3,
                h = 3,
                t = 5;
            while (i--) {
                switch (values[i]) {
                    case "block":
                    case "classic":
                    case "oval":
                    case "diamond":
                    case "open":
                    case "none":
                        type = values[i];
                        break;
                    case "wide": h = 5; break;
                    case "narrow": h = 2; break;
                    case "long": w = 5; break;
                    case "short": w = 2; break;
                }
            }
            if (type == "open") {
                w += 2;
                h += 2;
                t += 2;
                dx = 1;
                refX = isEnd ? 4 : 1;
                attr = {
                    fill: "none",
                    stroke: attrs.stroke
                };
            } else {
                refX = dx = w / 2;
                attr = {
                    fill: attrs.stroke,
                    stroke: "none"
                };
            }
            if (o._.arrows) {
                if (isEnd) {
                    o._.arrows.endPath && markerCounter[o._.arrows.endPath]--;
                    o._.arrows.endMarker && markerCounter[o._.arrows.endMarker]--;
                } else {
                    o._.arrows.startPath && markerCounter[o._.arrows.startPath]--;
                    o._.arrows.startMarker && markerCounter[o._.arrows.startMarker]--;
                }
            } else {
                o._.arrows = {};
            }
            if (type != "none") {
                var pathId = "raphael-marker-" + type,
                    markerId = "raphael-marker-" + se + type + w + h;
                if (!R._g.doc.getElementById(pathId)) {
                    p.defs.appendChild($($("path"), {
                        "stroke-linecap": "round",
                        d: markers[type],
                        id: pathId
                    }));
                    markerCounter[pathId] = 1;
                } else {
                    markerCounter[pathId]++;
                }
                var marker = R._g.doc.getElementById(markerId),
                    use;
                if (!marker) {
                    marker = $($("marker"), {
                        id: markerId,
                        markerHeight: h,
                        markerWidth: w,
                        orient: "auto",
                        refX: refX,
                        refY: h / 2
                    });
                    use = $($("use"), {
                        "xlink:href": "#" + pathId,
                        transform: (isEnd ? "rotate(180 " + w / 2 + " " + h / 2 + ") " : E) + "scale(" + w / t + "," + h / t + ")",
                        "stroke-width": (1 / ((w / t + h / t) / 2)).toFixed(4)
                    });
                    marker.appendChild(use);
                    p.defs.appendChild(marker);
                    markerCounter[markerId] = 1;
                } else {
                    markerCounter[markerId]++;
                    use = marker.getElementsByTagName("use")[0];
                }
                $(use, attr);
                var delta = dx * (type != "diamond" && type != "oval");
                if (isEnd) {
                    from = o._.arrows.startdx * stroke || 0;
                    to = R.getTotalLength(attrs.path) - delta * stroke;
                } else {
                    from = delta * stroke;
                    to = R.getTotalLength(attrs.path) - (o._.arrows.enddx * stroke || 0);
                }
                attr = {};
                attr["marker-" + se] = "url(#" + markerId + ")";
                if (to || from) {
                    attr.d = R.getSubpath(attrs.path, from, to);
                }
                $(node, attr);
                o._.arrows[se + "Path"] = pathId;
                o._.arrows[se + "Marker"] = markerId;
                o._.arrows[se + "dx"] = delta;
                o._.arrows[se + "Type"] = type;
                o._.arrows[se + "String"] = value;
            } else {
                if (isEnd) {
                    from = o._.arrows.startdx * stroke || 0;
                    to = R.getTotalLength(attrs.path) - from;
                } else {
                    from = 0;
                    to = R.getTotalLength(attrs.path) - (o._.arrows.enddx * stroke || 0);
                }
                o._.arrows[se + "Path"] && $(node, {d: R.getSubpath(attrs.path, from, to)});
                delete o._.arrows[se + "Path"];
                delete o._.arrows[se + "Marker"];
                delete o._.arrows[se + "dx"];
                delete o._.arrows[se + "Type"];
                delete o._.arrows[se + "String"];
            }
            for (attr in markerCounter) if (markerCounter[has](attr) && !markerCounter[attr]) {
                var item = R._g.doc.getElementById(attr);
                item && item.parentNode.removeChild(item);
            }
        }
    },
    dasharray = {
        "": [0],
        "none": [0],
        "-": [3, 1],
        ".": [1, 1],
        "-.": [3, 1, 1, 1],
        "-..": [3, 1, 1, 1, 1, 1],
        ". ": [1, 3],
        "- ": [4, 3],
        "--": [8, 3],
        "- .": [4, 3, 1, 3],
        "--.": [8, 3, 1, 3],
        "--..": [8, 3, 1, 3, 1, 3]
    },
    addDashes = function (o, value, params) {
        value = dasharray[Str(value).toLowerCase()];
        if (value) {
            var width = o.attrs["stroke-width"] || "1",
                butt = {round: width, square: width, butt: 0}[o.attrs["stroke-linecap"] || params["stroke-linecap"]] || 0,
                dashes = [],
                i = value.length;
            while (i--) {
                dashes[i] = value[i] * width + ((i % 2) ? 1 : -1) * butt;
            }
            $(o.node, {"stroke-dasharray": dashes.join(",")});
        }
    },
    setFillAndStroke = function (o, params) {
        var node = o.node,
            attrs = o.attrs,
            vis = node.style.visibility;
        node.style.visibility = "hidden";
        for (var att in params) {
            if (params[has](att)) {
                if (!R._availableAttrs[has](att)) {
                    continue;
                }
                var value = params[att];
                attrs[att] = value;
                switch (att) {
                    case "blur":
                        o.blur(value);
                        break;
                    case "href":
                    case "title":
                        var hl = $("title");
                        var val = R._g.doc.createTextNode(value);
                        hl.appendChild(val);
                        node.appendChild(hl);
                        break;
                    case "target":
                        var pn = node.parentNode;
                        if (pn.tagName.toLowerCase() != "a") {
                            var hl = $("a");
                            pn.insertBefore(hl, node);
                            hl.appendChild(node);
                            pn = hl;
                        }
                        if (att == "target") {
                            pn.setAttributeNS(xlink, "show", value == "blank" ? "new" : value);
                        } else {
                            pn.setAttributeNS(xlink, att, value);
                        }
                        break;
                    case "cursor":
                        node.style.cursor = value;
                        break;
                    case "transform":
                        o.transform(value);
                        break;
                    case "arrow-start":
                        addArrow(o, value);
                        break;
                    case "arrow-end":
                        addArrow(o, value, 1);
                        break;
                    case "clip-rect":
                        var rect = Str(value).split(separator);
                        if (rect.length == 4) {
                            o.clip && o.clip.parentNode.parentNode.removeChild(o.clip.parentNode);
                            var el = $("clipPath"),
                                rc = $("rect");
                            el.id = R.createUUID();
                            $(rc, {
                                x: rect[0],
                                y: rect[1],
                                width: rect[2],
                                height: rect[3]
                            });
                            el.appendChild(rc);
                            o.paper.defs.appendChild(el);
                            $(node, {"clip-path": "url(#" + el.id + ")"});
                            o.clip = rc;
                        }
                        if (!value) {
                            var path = node.getAttribute("clip-path");
                            if (path) {
                                var clip = R._g.doc.getElementById(path.replace(/(^url\(#|\)$)/g, E));
                                clip && clip.parentNode.removeChild(clip);
                                $(node, {"clip-path": E});
                                delete o.clip;
                            }
                        }
                    break;
                    case "path":
                        if (o.type == "path") {
                            $(node, {d: value ? attrs.path = R._pathToAbsolute(value) : "M0,0"});
                            o._.dirty = 1;
                            if (o._.arrows) {
                                "startString" in o._.arrows && addArrow(o, o._.arrows.startString);
                                "endString" in o._.arrows && addArrow(o, o._.arrows.endString, 1);
                            }
                        }
                        break;
                    case "width":
                        node.setAttribute(att, value);
                        o._.dirty = 1;
                        if (attrs.fx) {
                            att = "x";
                            value = attrs.x;
                        } else {
                            break;
                        }
                    case "x":
                        if (attrs.fx) {
                            value = -attrs.x - (attrs.width || 0);
                        }
                    case "rx":
                        if (att == "rx" && o.type == "rect") {
                            break;
                        }
                    case "cx":
                        node.setAttribute(att, value);
                        o.pattern && updatePosition(o);
                        o._.dirty = 1;
                        break;
                    case "height":
                        node.setAttribute(att, value);
                        o._.dirty = 1;
                        if (attrs.fy) {
                            att = "y";
                            value = attrs.y;
                        } else {
                            break;
                        }
                    case "y":
                        if (attrs.fy) {
                            value = -attrs.y - (attrs.height || 0);
                        }
                    case "ry":
                        if (att == "ry" && o.type == "rect") {
                            break;
                        }
                    case "cy":
                        node.setAttribute(att, value);
                        o.pattern && updatePosition(o);
                        o._.dirty = 1;
                        break;
                    case "r":
                        if (o.type == "rect") {
                            $(node, {rx: value, ry: value});
                        } else {
                            node.setAttribute(att, value);
                        }
                        o._.dirty = 1;
                        break;
                    case "src":
                        if (o.type == "image") {
                            node.setAttributeNS(xlink, "href", value);
                        }
                        break;
                    case "stroke-width":
                        if (o._.sx != 1 || o._.sy != 1) {
                            value /= mmax(abs(o._.sx), abs(o._.sy)) || 1;
                        }
                        if (o.paper._vbSize) {
                            value *= o.paper._vbSize;
                        }
                        node.setAttribute(att, value);
                        if (attrs["stroke-dasharray"]) {
                            addDashes(o, attrs["stroke-dasharray"], params);
                        }
                        if (o._.arrows) {
                            "startString" in o._.arrows && addArrow(o, o._.arrows.startString);
                            "endString" in o._.arrows && addArrow(o, o._.arrows.endString, 1);
                        }
                        break;
                    case "stroke-dasharray":
                        addDashes(o, value, params);
                        break;
                    case "fill":
                        var isURL = Str(value).match(R._ISURL);
                        if (isURL) {
                            el = $("pattern");
                            var ig = $("image");
                            el.id = R.createUUID();
                            $(el, {x: 0, y: 0, patternUnits: "userSpaceOnUse", height: 1, width: 1});
                            $(ig, {x: 0, y: 0, "xlink:href": isURL[1]});
                            el.appendChild(ig);

                            (function (el) {
                                R._preload(isURL[1], function () {
                                    var w = this.offsetWidth,
                                        h = this.offsetHeight;
                                    $(el, {width: w, height: h});
                                    $(ig, {width: w, height: h});
                                    o.paper.safari();
                                });
                            })(el);
                            o.paper.defs.appendChild(el);
                            $(node, {fill: "url(#" + el.id + ")"});
                            o.pattern = el;
                            o.pattern && updatePosition(o);
                            break;
                        }
                        var clr = R.getRGB(value);
                        if (!clr.error) {
                            delete params.gradient;
                            delete attrs.gradient;
                            !R.is(attrs.opacity, "undefined") &&
                                R.is(params.opacity, "undefined") &&
                                $(node, {opacity: attrs.opacity});
                            !R.is(attrs["fill-opacity"], "undefined") &&
                                R.is(params["fill-opacity"], "undefined") &&
                                $(node, {"fill-opacity": attrs["fill-opacity"]});
                        } else if ((o.type == "circle" || o.type == "ellipse" || Str(value).charAt() != "r") && addGradientFill(o, value)) {
                            if ("opacity" in attrs || "fill-opacity" in attrs) {
                                var gradient = R._g.doc.getElementById(node.getAttribute("fill").replace(/^url\(#|\)$/g, E));
                                if (gradient) {
                                    var stops = gradient.getElementsByTagName("stop");
                                    $(stops[stops.length - 1], {"stop-opacity": ("opacity" in attrs ? attrs.opacity : 1) * ("fill-opacity" in attrs ? attrs["fill-opacity"] : 1)});
                                }
                            }
                            attrs.gradient = value;
                            attrs.fill = "none";
                            break;
                        }
                        clr[has]("opacity") && $(node, {"fill-opacity": clr.opacity > 1 ? clr.opacity / 100 : clr.opacity});
                    case "stroke":
                        clr = R.getRGB(value);
                        node.setAttribute(att, clr.hex);
                        att == "stroke" && clr[has]("opacity") && $(node, {"stroke-opacity": clr.opacity > 1 ? clr.opacity / 100 : clr.opacity});
                        if (att == "stroke" && o._.arrows) {
                            "startString" in o._.arrows && addArrow(o, o._.arrows.startString);
                            "endString" in o._.arrows && addArrow(o, o._.arrows.endString, 1);
                        }
                        break;
                    case "gradient":
                        (o.type == "circle" || o.type == "ellipse" || Str(value).charAt() != "r") && addGradientFill(o, value);
                        break;
                    case "opacity":
                        if (attrs.gradient && !attrs[has]("stroke-opacity")) {
                            $(node, {"stroke-opacity": value > 1 ? value / 100 : value});
                        }
                        // fall
                    case "fill-opacity":
                        if (attrs.gradient) {
                            gradient = R._g.doc.getElementById(node.getAttribute("fill").replace(/^url\(#|\)$/g, E));
                            if (gradient) {
                                stops = gradient.getElementsByTagName("stop");
                                $(stops[stops.length - 1], {"stop-opacity": value});
                            }
                            break;
                        }
                    default:
                        att == "font-size" && (value = toInt(value, 10) + "px");
                        var cssrule = att.replace(/(\-.)/g, function (w) {
                            return w.substring(1).toUpperCase();
                        });
                        node.style[cssrule] = value;
                        o._.dirty = 1;
                        node.setAttribute(att, value);
                        break;
                }
            }
        }

        tuneText(o, params);
        node.style.visibility = vis;
    },
    leading = 1.2,
    tuneText = function (el, params) {
        if (el.type != "text" || !(params[has]("text") || params[has]("font") || params[has]("font-size") || params[has]("x") || params[has]("y"))) {
            return;
        }
        var a = el.attrs,
            node = el.node,
            fontSize = node.firstChild ? toInt(R._g.doc.defaultView.getComputedStyle(node.firstChild, E).getPropertyValue("font-size"), 10) : 10;

        if (params[has]("text")) {
            a.text = params.text;
            while (node.firstChild) {
                node.removeChild(node.firstChild);
            }
            var texts = Str(params.text).split("\n"),
                tspans = [],
                tspan;
            for (var i = 0, ii = texts.length; i < ii; i++) {
                tspan = $("tspan");
                i && $(tspan, {dy: fontSize * leading, x: a.x});
                tspan.appendChild(R._g.doc.createTextNode(texts[i]));
                node.appendChild(tspan);
                tspans[i] = tspan;
            }
        } else {
            tspans = node.getElementsByTagName("tspan");
            for (i = 0, ii = tspans.length; i < ii; i++) if (i) {
                $(tspans[i], {dy: fontSize * leading, x: a.x});
            } else {
                $(tspans[0], {dy: 0});
            }
        }
        $(node, {x: a.x, y: a.y});
        el._.dirty = 1;
        var bb = el._getBBox(),
            dif = a.y - (bb.y + bb.height / 2);
        dif && R.is(dif, "finite") && $(tspans[0], {dy: dif});
    },
    Element = function (node, svg) {
        var X = 0,
            Y = 0;
        /*\
         * Element.node
         [ property (object) ]
         **
         * Gives you a reference to the DOM object, so you can assign event handlers or just mess around.
         **
         * Note: Don’t mess with it.
         > Usage
         | // draw a circle at coordinate 10,10 with radius of 10
         | var c = paper.circle(10, 10, 10);
         | c.node.onclick = function () {
         |     c.attr("fill", "red");
         | };
        \*/
        this[0] = this.node = node;
        /*\
         * Element.raphael
         [ property (object) ]
         **
         * Internal reference to @Raphael object. In case it is not available.
         > Usage
         | Raphael.el.red = function () {
         |     var hsb = this.paper.raphael.rgb2hsb(this.attr("fill"));
         |     hsb.h = 1;
         |     this.attr({fill: this.paper.raphael.hsb2rgb(hsb).hex});
         | }
        \*/
        node.raphael = true;
        /*\
         * Element.id
         [ property (number) ]
         **
         * Unique id of the element. Especially usesful when you want to listen to events of the element, 
         * because all events are fired in format `<module>.<action>.<id>`. Also useful for @Paper.getById method.
        \*/
        this.id = R._oid++;
        node.raphaelid = this.id;
        this.matrix = R.matrix();
        this.realPath = null;
        /*\
         * Element.paper
         [ property (object) ]
         **
         * Internal reference to “paper” where object drawn. Mainly for use in plugins and element extensions.
         > Usage
         | Raphael.el.cross = function () {
         |     this.attr({fill: "red"});
         |     this.paper.path("M10,10L50,50M50,10L10,50")
         |         .attr({stroke: "red"});
         | }
        \*/
        this.paper = svg;
        this.attrs = this.attrs || {};
        this._ = {
            transform: [],
            sx: 1,
            sy: 1,
            deg: 0,
            dx: 0,
            dy: 0,
            dirty: 1
        };
        !svg.bottom && (svg.bottom = this);
        /*\
         * Element.prev
         [ property (object) ]
         **
         * Reference to the previous element in the hierarchy.
        \*/
        this.prev = svg.top;
        svg.top && (svg.top.next = this);
        svg.top = this;
        /*\
         * Element.next
         [ property (object) ]
         **
         * Reference to the next element in the hierarchy.
        \*/
        this.next = null;
    },
    elproto = R.el;

    Element.prototype = elproto;
    elproto.constructor = Element;

    R._engine.path = function (pathString, SVG) {
        var el = $("path");
        SVG.canvas && SVG.canvas.appendChild(el);
        var p = new Element(el, SVG);
        p.type = "path";
        setFillAndStroke(p, {
            fill: "none",
            stroke: "#000",
            path: pathString
        });
        return p;
    };
    /*\
     * Element.rotate
     [ method ]
     **
     * Deprecated! Use @Element.transform instead.
     * Adds rotation by given angle around given point to the list of
     * transformations of the element.
     > Parameters
     - deg (number) angle in degrees
     - cx (number) #optional x coordinate of the centre of rotation
     - cy (number) #optional y coordinate of the centre of rotation
     * If cx & cy aren’t specified centre of the shape is used as a point of rotation.
     = (object) @Element
    \*/
    elproto.rotate = function (deg, cx, cy) {
        if (this.removed) {
            return this;
        }
        deg = Str(deg).split(separator);
        if (deg.length - 1) {
            cx = toFloat(deg[1]);
            cy = toFloat(deg[2]);
        }
        deg = toFloat(deg[0]);
        (cy == null) && (cx = cy);
        if (cx == null || cy == null) {
            var bbox = this.getBBox(1);
            cx = bbox.x + bbox.width / 2;
            cy = bbox.y + bbox.height / 2;
        }
        this.transform(this._.transform.concat([["r", deg, cx, cy]]));
        return this;
    };
    /*\
     * Element.scale
     [ method ]
     **
     * Deprecated! Use @Element.transform instead.
     * Adds scale by given amount relative to given point to the list of
     * transformations of the element.
     > Parameters
     - sx (number) horisontal scale amount
     - sy (number) vertical scale amount
     - cx (number) #optional x coordinate of the centre of scale
     - cy (number) #optional y coordinate of the centre of scale
     * If cx & cy aren’t specified centre of the shape is used instead.
     = (object) @Element
    \*/
    elproto.scale = function (sx, sy, cx, cy) {
        if (this.removed) {
            return this;
        }
        sx = Str(sx).split(separator);
        if (sx.length - 1) {
            sy = toFloat(sx[1]);
            cx = toFloat(sx[2]);
            cy = toFloat(sx[3]);
        }
        sx = toFloat(sx[0]);
        (sy == null) && (sy = sx);
        (cy == null) && (cx = cy);
        if (cx == null || cy == null) {
            var bbox = this.getBBox(1);
        }
        cx = cx == null ? bbox.x + bbox.width / 2 : cx;
        cy = cy == null ? bbox.y + bbox.height / 2 : cy;
        this.transform(this._.transform.concat([["s", sx, sy, cx, cy]]));
        return this;
    };
    /*\
     * Element.translate
     [ method ]
     **
     * Deprecated! Use @Element.transform instead.
     * Adds translation by given amount to the list of transformations of the element.
     > Parameters
     - dx (number) horisontal shift
     - dy (number) vertical shift
     = (object) @Element
    \*/
    elproto.translate = function (dx, dy) {
        if (this.removed) {
            return this;
        }
        dx = Str(dx).split(separator);
        if (dx.length - 1) {
            dy = toFloat(dx[1]);
        }
        dx = toFloat(dx[0]) || 0;
        dy = +dy || 0;
        this.transform(this._.transform.concat([["t", dx, dy]]));
        return this;
    };
    /*\
     * Element.transform
     [ method ]
     **
     * Adds transformation to the element which is separate to other attributes,
     * i.e. translation doesn’t change `x` or `y` of the rectange. The format
     * of transformation string is similar to the path string syntax:
     | "t100,100r30,100,100s2,2,100,100r45s1.5"
     * Each letter is a command. There are four commands: `t` is for translate, `r` is for rotate, `s` is for
     * scale and `m` is for matrix.
     *
     * There are also alternative “absolute” translation, rotation and scale: `T`, `R` and `S`. They will not take previous transformation into account. For example, `...T100,0` will always move element 100 px horisontally, while `...t100,0` could move it vertically if there is `r90` before. Just compare results of `r90t100,0` and `r90T100,0`.
     *
     * So, the example line above could be read like “translate by 100, 100; rotate 30° around 100, 100; scale twice around 100, 100;
     * rotate 45° around centre; scale 1.5 times relative to centre”. As you can see rotate and scale commands have origin
     * coordinates as optional parameters, the default is the centre point of the element.
     * Matrix accepts six parameters.
     > Usage
     | var el = paper.rect(10, 20, 300, 200);
     | // translate 100, 100, rotate 45°, translate -100, 0
     | el.transform("t100,100r45t-100,0");
     | // if you want you can append or prepend transformations
     | el.transform("...t50,50");
     | el.transform("s2...");
     | // or even wrap
     | el.transform("t50,50...t-50-50");
     | // to reset transformation call method with empty string
     | el.transform("");
     | // to get current value call it without parameters
     | console.log(el.transform());
     > Parameters
     - tstr (string) #optional transformation string
     * If tstr isn’t specified
     = (string) current transformation string
     * else
     = (object) @Element
    \*/
    elproto.transform = function (tstr) {
        var _ = this._;
        if (tstr == null) {
            return _.transform;
        }
        R._extractTransform(this, tstr);

        this.clip && $(this.clip, {transform: this.matrix.invert()});
        this.pattern && updatePosition(this);
        this.node && $(this.node, {transform: this.matrix});
    
        if (_.sx != 1 || _.sy != 1) {
            var sw = this.attrs[has]("stroke-width") ? this.attrs["stroke-width"] : 1;
            this.attr({"stroke-width": sw});
        }

        return this;
    };
    /*\
     * Element.hide
     [ method ]
     **
     * Makes element invisible. See @Element.show.
     = (object) @Element
    \*/
    elproto.hide = function () {
        !this.removed && this.paper.safari(this.node.style.display = "none");
        return this;
    };
    /*\
     * Element.show
     [ method ]
     **
     * Makes element visible. See @Element.hide.
     = (object) @Element
    \*/
    elproto.show = function () {
        !this.removed && this.paper.safari(this.node.style.display = "");
        return this;
    };
    /*\
     * Element.remove
     [ method ]
     **
     * Removes element from the paper.
    \*/
    elproto.remove = function () {
        if (this.removed || !this.node.parentNode) {
            return;
        }
        var paper = this.paper;
        paper.__set__ && paper.__set__.exclude(this);
        eve.unbind("raphael.*.*." + this.id);
        if (this.gradient) {
            paper.defs.removeChild(this.gradient);
        }
        R._tear(this, paper);
        if (this.node.parentNode.tagName.toLowerCase() == "a") {
            this.node.parentNode.parentNode.removeChild(this.node.parentNode);
        } else {
            this.node.parentNode.removeChild(this.node);
        }
        for (var i in this) {
            this[i] = typeof this[i] == "function" ? R._removedFactory(i) : null;
        }
        this.removed = true;
    };
    elproto._getBBox = function () {
        if (this.node.style.display == "none") {
            this.show();
            var hide = true;
        }
        var bbox = {};
        try {
            bbox = this.node.getBBox();
        } catch(e) {
            // Firefox 3.0.x plays badly here
        } finally {
            bbox = bbox || {};
        }
        hide && this.hide();
        return bbox;
    };
    /*\
     * Element.attr
     [ method ]
     **
     * Sets the attributes of the element.
     > Parameters
     - attrName (string) attribute’s name
     - value (string) value
     * or
     - params (object) object of name/value pairs
     * or
     - attrName (string) attribute’s name
     * or
     - attrNames (array) in this case method returns array of current values for given attribute names
     = (object) @Element if attrsName & value or params are passed in.
     = (...) value of the attribute if only attrsName is passed in.
     = (array) array of values of the attribute if attrsNames is passed in.
     = (object) object of attributes if nothing is passed in.
     > Possible parameters
     # <p>Please refer to the <a href="http://www.w3.org/TR/SVG/" title="The W3C Recommendation for the SVG language describes these properties in detail.">SVG specification</a> for an explanation of these parameters.</p>
     o arrow-end (string) arrowhead on the end of the path. The format for string is `<type>[-<width>[-<length>]]`. Possible types: `classic`, `block`, `open`, `oval`, `diamond`, `none`, width: `wide`, `narrow`, `medium`, length: `long`, `short`, `midium`.
     o clip-rect (string) comma or space separated values: x, y, width and height
     o cursor (string) CSS type of the cursor
     o cx (number) the x-axis coordinate of the center of the circle, or ellipse
     o cy (number) the y-axis coordinate of the center of the circle, or ellipse
     o fill (string) colour, gradient or image
     o fill-opacity (number)
     o font (string)
     o font-family (string)
     o font-size (number) font size in pixels
     o font-weight (string)
     o height (number)
     o href (string) URL, if specified element behaves as hyperlink
     o opacity (number)
     o path (string) SVG path string format
     o r (number) radius of the circle, ellipse or rounded corner on the rect
     o rx (number) horisontal radius of the ellipse
     o ry (number) vertical radius of the ellipse
     o src (string) image URL, only works for @Element.image element
     o stroke (string) stroke colour
     o stroke-dasharray (string) [“”, “`-`”, “`.`”, “`-.`”, “`-..`”, “`. `”, “`- `”, “`--`”, “`- .`”, “`--.`”, “`--..`”]
     o stroke-linecap (string) [“`butt`”, “`square`”, “`round`”]
     o stroke-linejoin (string) [“`bevel`”, “`round`”, “`miter`”]
     o stroke-miterlimit (number)
     o stroke-opacity (number)
     o stroke-width (number) stroke width in pixels, default is '1'
     o target (string) used with href
     o text (string) contents of the text element. Use `\n` for multiline text
     o text-anchor (string) [“`start`”, “`middle`”, “`end`”], default is “`middle`”
     o title (string) will create tooltip with a given text
     o transform (string) see @Element.transform
     o width (number)
     o x (number)
     o y (number)
     > Gradients
     * Linear gradient format: “`‹angle›-‹colour›[-‹colour›[:‹offset›]]*-‹colour›`”, example: “`90-#fff-#000`” – 90°
     * gradient from white to black or “`0-#fff-#f00:20-#000`” – 0° gradient from white via red (at 20%) to black.
     *
     * radial gradient: “`r[(‹fx›, ‹fy›)]‹colour›[-‹colour›[:‹offset›]]*-‹colour›`”, example: “`r#fff-#000`” –
     * gradient from white to black or “`r(0.25, 0.75)#fff-#000`” – gradient from white to black with focus point
     * at 0.25, 0.75. Focus point coordinates are in 0..1 range. Radial gradients can only be applied to circles and ellipses.
     > Path String
     # <p>Please refer to <a href="http://www.w3.org/TR/SVG/paths.html#PathData" title="Details of a path’s data attribute’s format are described in the SVG specification.">SVG documentation regarding path string</a>. Raphaël fully supports it.</p>
     > Colour Parsing
     # <ul>
     #     <li>Colour name (“<code>red</code>”, “<code>green</code>”, “<code>cornflowerblue</code>”, etc)</li>
     #     <li>#••• — shortened HTML colour: (“<code>#000</code>”, “<code>#fc0</code>”, etc)</li>
     #     <li>#•••••• — full length HTML colour: (“<code>#000000</code>”, “<code>#bd2300</code>”)</li>
     #     <li>rgb(•••, •••, •••) — red, green and blue channels’ values: (“<code>rgb(200,&nbsp;100,&nbsp;0)</code>”)</li>
     #     <li>rgb(•••%, •••%, •••%) — same as above, but in %: (“<code>rgb(100%,&nbsp;175%,&nbsp;0%)</code>”)</li>
     #     <li>rgba(•••, •••, •••, •••) — red, green and blue channels’ values: (“<code>rgba(200,&nbsp;100,&nbsp;0, .5)</code>”)</li>
     #     <li>rgba(•••%, •••%, •••%, •••%) — same as above, but in %: (“<code>rgba(100%,&nbsp;175%,&nbsp;0%, 50%)</code>”)</li>
     #     <li>hsb(•••, •••, •••) — hue, saturation and brightness values: (“<code>hsb(0.5,&nbsp;0.25,&nbsp;1)</code>”)</li>
     #     <li>hsb(•••%, •••%, •••%) — same as above, but in %</li>
     #     <li>hsba(•••, •••, •••, •••) — same as above, but with opacity</li>
     #     <li>hsl(•••, •••, •••) — almost the same as hsb, see <a href="http://en.wikipedia.org/wiki/HSL_and_HSV" title="HSL and HSV - Wikipedia, the free encyclopedia">Wikipedia page</a></li>
     #     <li>hsl(•••%, •••%, •••%) — same as above, but in %</li>
     #     <li>hsla(•••, •••, •••, •••) — same as above, but with opacity</li>
     #     <li>Optionally for hsb and hsl you could specify hue as a degree: “<code>hsl(240deg,&nbsp;1,&nbsp;.5)</code>” or, if you want to go fancy, “<code>hsl(240°,&nbsp;1,&nbsp;.5)</code>”</li>
     # </ul>
    \*/
    elproto.attr = function (name, value) {
        if (this.removed) {
            return this;
        }
        if (name == null) {
            var res = {};
            for (var a in this.attrs) if (this.attrs[has](a)) {
                res[a] = this.attrs[a];
            }
            res.gradient && res.fill == "none" && (res.fill = res.gradient) && delete res.gradient;
            res.transform = this._.transform;
            return res;
        }
        if (value == null && R.is(name, "string")) {
            if (name == "fill" && this.attrs.fill == "none" && this.attrs.gradient) {
                return this.attrs.gradient;
            }
            if (name == "transform") {
                return this._.transform;
            }
            var names = name.split(separator),
                out = {};
            for (var i = 0, ii = names.length; i < ii; i++) {
                name = names[i];
                if (name in this.attrs) {
                    out[name] = this.attrs[name];
                } else if (R.is(this.paper.customAttributes[name], "function")) {
                    out[name] = this.paper.customAttributes[name].def;
                } else {
                    out[name] = R._availableAttrs[name];
                }
            }
            return ii - 1 ? out : out[names[0]];
        }
        if (value == null && R.is(name, "array")) {
            out = {};
            for (i = 0, ii = name.length; i < ii; i++) {
                out[name[i]] = this.attr(name[i]);
            }
            return out;
        }
        if (value != null) {
            var params = {};
            params[name] = value;
        } else if (name != null && R.is(name, "object")) {
            params = name;
        }
        for (var key in params) {
            eve("raphael.attr." + key + "." + this.id, this, params[key]);
        }
        for (key in this.paper.customAttributes) if (this.paper.customAttributes[has](key) && params[has](key) && R.is(this.paper.customAttributes[key], "function")) {
            var par = this.paper.customAttributes[key].apply(this, [].concat(params[key]));
            this.attrs[key] = params[key];
            for (var subkey in par) if (par[has](subkey)) {
                params[subkey] = par[subkey];
            }
        }
        setFillAndStroke(this, params);
        return this;
    };
    /*\
     * Element.toFront
     [ method ]
     **
     * Moves the element so it is the closest to the viewer’s eyes, on top of other elements.
     = (object) @Element
    \*/
    elproto.toFront = function () {
        if (this.removed) {
            return this;
        }
        if (this.node.parentNode.tagName.toLowerCase() == "a") {
            this.node.parentNode.parentNode.appendChild(this.node.parentNode);
        } else {
            this.node.parentNode.appendChild(this.node);
        }
        var svg = this.paper;
        svg.top != this && R._tofront(this, svg);
        return this;
    };
    /*\
     * Element.toBack
     [ method ]
     **
     * Moves the element so it is the furthest from the viewer’s eyes, behind other elements.
     = (object) @Element
    \*/
    elproto.toBack = function () {
        if (this.removed) {
            return this;
        }
        var parent = this.node.parentNode;
        if (parent.tagName.toLowerCase() == "a") {
            parent.parentNode.insertBefore(this.node.parentNode, this.node.parentNode.parentNode.firstChild); 
        } else if (parent.firstChild != this.node) {
            parent.insertBefore(this.node, this.node.parentNode.firstChild);
        }
        R._toback(this, this.paper);
        var svg = this.paper;
        return this;
    };
    /*\
     * Element.insertAfter
     [ method ]
     **
     * Inserts current object after the given one.
     = (object) @Element
    \*/
    elproto.insertAfter = function (element) {
        if (this.removed) {
            return this;
        }
        var node = element.node || element[element.length - 1].node;
        if (node.nextSibling) {
            node.parentNode.insertBefore(this.node, node.nextSibling);
        } else {
            node.parentNode.appendChild(this.node);
        }
        R._insertafter(this, element, this.paper);
        return this;
    };
    /*\
     * Element.insertBefore
     [ method ]
     **
     * Inserts current object before the given one.
     = (object) @Element
    \*/
    elproto.insertBefore = function (element) {
        if (this.removed) {
            return this;
        }
        var node = element.node || element[0].node;
        node.parentNode.insertBefore(this.node, node);
        R._insertbefore(this, element, this.paper);
        return this;
    };
    elproto.blur = function (size) {
        // Experimental. No Safari support. Use it on your own risk.
        var t = this;
        if (+size !== 0) {
            var fltr = $("filter"),
                blur = $("feGaussianBlur");
            t.attrs.blur = size;
            fltr.id = R.createUUID();
            $(blur, {stdDeviation: +size || 1.5});
            fltr.appendChild(blur);
            t.paper.defs.appendChild(fltr);
            t._blur = fltr;
            $(t.node, {filter: "url(#" + fltr.id + ")"});
        } else {
            if (t._blur) {
                t._blur.parentNode.removeChild(t._blur);
                delete t._blur;
                delete t.attrs.blur;
            }
            t.node.removeAttribute("filter");
        }
        return t;
    };
    R._engine.circle = function (svg, x, y, r) {
        var el = $("circle");
        svg.canvas && svg.canvas.appendChild(el);
        var res = new Element(el, svg);
        res.attrs = {cx: x, cy: y, r: r, fill: "none", stroke: "#000"};
        res.type = "circle";
        $(el, res.attrs);
        return res;
    };
    R._engine.rect = function (svg, x, y, w, h, r) {
        var el = $("rect");
        svg.canvas && svg.canvas.appendChild(el);
        var res = new Element(el, svg);
        res.attrs = {x: x, y: y, width: w, height: h, r: r || 0, rx: r || 0, ry: r || 0, fill: "none", stroke: "#000"};
        res.type = "rect";
        $(el, res.attrs);
        return res;
    };
    R._engine.ellipse = function (svg, x, y, rx, ry) {
        var el = $("ellipse");
        svg.canvas && svg.canvas.appendChild(el);
        var res = new Element(el, svg);
        res.attrs = {cx: x, cy: y, rx: rx, ry: ry, fill: "none", stroke: "#000"};
        res.type = "ellipse";
        $(el, res.attrs);
        return res;
    };
    R._engine.image = function (svg, src, x, y, w, h) {
        var el = $("image");
        $(el, {x: x, y: y, width: w, height: h, preserveAspectRatio: "none"});
        el.setAttributeNS(xlink, "href", src);
        svg.canvas && svg.canvas.appendChild(el);
        var res = new Element(el, svg);
        res.attrs = {x: x, y: y, width: w, height: h, src: src};
        res.type = "image";
        return res;
    };
    R._engine.text = function (svg, x, y, text) {
        var el = $("text");
        svg.canvas && svg.canvas.appendChild(el);
        var res = new Element(el, svg);
        res.attrs = {
            x: x,
            y: y,
            "text-anchor": "middle",
            text: text,
            font: R._availableAttrs.font,
            stroke: "none",
            fill: "#000"
        };
        res.type = "text";
        setFillAndStroke(res, res.attrs);
        return res;
    };
    R._engine.setSize = function (width, height) {
        this.width = width || this.width;
        this.height = height || this.height;
        this.canvas.setAttribute("width", this.width);
        this.canvas.setAttribute("height", this.height);
        if (this._viewBox) {
            this.setViewBox.apply(this, this._viewBox);
        }
        return this;
    };
    R._engine.create = function () {
        var con = R._getContainer.apply(0, arguments),
            container = con && con.container,
            x = con.x,
            y = con.y,
            width = con.width,
            height = con.height;
        if (!container) {
            throw new Error("SVG container not found.");
        }
        var cnvs = $("svg"),
            css = "overflow:hidden;",
            isFloating;
        x = x || 0;
        y = y || 0;
        width = width || 512;
        height = height || 342;
        $(cnvs, {
            height: height,
            version: 1.1,
            width: width,
            xmlns: "http://www.w3.org/2000/svg"
        });
        if (container == 1) {
            cnvs.style.cssText = css + "position:absolute;left:" + x + "px;top:" + y + "px";
            R._g.doc.body.appendChild(cnvs);
            isFloating = 1;
        } else {
            cnvs.style.cssText = css + "position:relative";
            if (container.firstChild) {
                container.insertBefore(cnvs, container.firstChild);
            } else {
                container.appendChild(cnvs);
            }
        }
        container = new R._Paper;
        container.width = width;
        container.height = height;
        container.canvas = cnvs;
        container.clear();
        container._left = container._top = 0;
        isFloating && (container.renderfix = function () {});
        container.renderfix();
        return container;
    };
    R._engine.setViewBox = function (x, y, w, h, fit) {
        eve("raphael.setViewBox", this, this._viewBox, [x, y, w, h, fit]);
        var size = mmax(w / this.width, h / this.height),
            top = this.top,
            aspectRatio = fit ? "meet" : "xMinYMin",
            vb,
            sw;
        if (x == null) {
            if (this._vbSize) {
                size = 1;
            }
            delete this._vbSize;
            vb = "0 0 " + this.width + S + this.height;
        } else {
            this._vbSize = size;
            vb = x + S + y + S + w + S + h;
        }
        $(this.canvas, {
            viewBox: vb,
            preserveAspectRatio: aspectRatio
        });
        while (size && top) {
            sw = "stroke-width" in top.attrs ? top.attrs["stroke-width"] : 1;
            top.attr({"stroke-width": sw});
            top._.dirty = 1;
            top._.dirtyT = 1;
            top = top.prev;
        }
        this._viewBox = [x, y, w, h, !!fit];
        return this;
    };
    /*\
     * Paper.renderfix
     [ method ]
     **
     * Fixes the issue of Firefox and IE9 regarding subpixel rendering. If paper is dependant
     * on other elements after reflow it could shift half pixel which cause for lines to lost their crispness.
     * This method fixes the issue.
     **
       Special thanks to Mariusz Nowak (http://www.medikoo.com/) for this method.
    \*/
    R.prototype.renderfix = function () {
        var cnvs = this.canvas,
            s = cnvs.style,
            pos;
        try {
            pos = cnvs.getScreenCTM() || cnvs.createSVGMatrix();
        } catch (e) {
            pos = cnvs.createSVGMatrix();
        }
        var left = -pos.e % 1,
            top = -pos.f % 1;
        if (left || top) {
            if (left) {
                this._left = (this._left + left) % 1;
                s.left = this._left + "px";
            }
            if (top) {
                this._top = (this._top + top) % 1;
                s.top = this._top + "px";
            }
        }
    };
    /*\
     * Paper.clear
     [ method ]
     **
     * Clears the paper, i.e. removes all the elements.
    \*/
    R.prototype.clear = function () {
        R.eve("raphael.clear", this);
        var c = this.canvas;
        while (c.firstChild) {
            c.removeChild(c.firstChild);
        }
        this.bottom = this.top = null;
        (this.desc = $("desc")).appendChild(R._g.doc.createTextNode("Created with Rapha\xebl " + R.version));
        c.appendChild(this.desc);
        c.appendChild(this.defs = $("defs"));
    };
    /*\
     * Paper.remove
     [ method ]
     **
     * Removes the paper from the DOM.
    \*/
    R.prototype.remove = function () {
        eve("raphael.remove", this);
        this.canvas.parentNode && this.canvas.parentNode.removeChild(this.canvas);
        for (var i in this) {
            this[i] = typeof this[i] == "function" ? R._removedFactory(i) : null;
        }
    };
    var setproto = R.st;
    for (var method in elproto) if (elproto[has](method) && !setproto[has](method)) {
        setproto[method] = (function (methodname) {
            return function () {
                var arg = arguments;
                return this.forEach(function (el) {
                    el[methodname].apply(el, arg);
                });
            };
        })(method);
    }
})();

// ┌─────────────────────────────────────────────────────────────────────┐ \\
// │ Raphaël - JavaScript Vector Library                                 │ \\
// ├─────────────────────────────────────────────────────────────────────┤ \\
// │ VML Module                                                          │ \\
// ├─────────────────────────────────────────────────────────────────────┤ \\
// │ Copyright (c) 2008-2011 Dmitry Baranovskiy (http://raphaeljs.com)   │ \\
// │ Copyright (c) 2008-2011 Sencha Labs (http://sencha.com)             │ \\
// │ Licensed under the MIT (http://raphaeljs.com/license.html) license. │ \\
// └─────────────────────────────────────────────────────────────────────┘ \\

(function(){
    if (!R.vml) {
        return;
    }
    var has = "hasOwnProperty",
        Str = String,
        toFloat = parseFloat,
        math = Math,
        round = math.round,
        mmax = math.max,
        mmin = math.min,
        abs = math.abs,
        fillString = "fill",
        separator = /[, ]+/,
        eve = R.eve,
        ms = " progid:DXImageTransform.Microsoft",
        S = " ",
        E = "",
        map = {M: "m", L: "l", C: "c", Z: "x", m: "t", l: "r", c: "v", z: "x"},
        bites = /([clmz]),?([^clmz]*)/gi,
        blurregexp = / progid:\S+Blur\([^\)]+\)/g,
        val = /-?[^,\s-]+/g,
        cssDot = "position:absolute;left:0;top:0;width:1px;height:1px",
        zoom = 21600,
        pathTypes = {path: 1, rect: 1, image: 1},
        ovalTypes = {circle: 1, ellipse: 1},
        path2vml = function (path) {
            var total =  /[ahqstv]/ig,
                command = R._pathToAbsolute;
            Str(path).match(total) && (command = R._path2curve);
            total = /[clmz]/g;
            if (command == R._pathToAbsolute && !Str(path).match(total)) {
                var res = Str(path).replace(bites, function (all, command, args) {
                    var vals = [],
                        isMove = command.toLowerCase() == "m",
                        res = map[command];
                    args.replace(val, function (value) {
                        if (isMove && vals.length == 2) {
                            res += vals + map[command == "m" ? "l" : "L"];
                            vals = [];
                        }
                        vals.push(round(value * zoom));
                    });
                    return res + vals;
                });
                return res;
            }
            var pa = command(path), p, r;
            res = [];
            for (var i = 0, ii = pa.length; i < ii; i++) {
                p = pa[i];
                r = pa[i][0].toLowerCase();
                r == "z" && (r = "x");
                for (var j = 1, jj = p.length; j < jj; j++) {
                    r += round(p[j] * zoom) + (j != jj - 1 ? "," : E);
                }
                res.push(r);
            }
            return res.join(S);
        },
        compensation = function (deg, dx, dy) {
            var m = R.matrix();
            m.rotate(-deg, .5, .5);
            return {
                dx: m.x(dx, dy),
                dy: m.y(dx, dy)
            };
        },
        setCoords = function (p, sx, sy, dx, dy, deg) {
            var _ = p._,
                m = p.matrix,
                fillpos = _.fillpos,
                o = p.node,
                s = o.style,
                y = 1,
                flip = "",
                dxdy,
                kx = zoom / sx,
                ky = zoom / sy;
            s.visibility = "hidden";
            if (!sx || !sy) {
                return;
            }
            o.coordsize = abs(kx) + S + abs(ky);
            s.rotation = deg * (sx * sy < 0 ? -1 : 1);
            if (deg) {
                var c = compensation(deg, dx, dy);
                dx = c.dx;
                dy = c.dy;
            }
            sx < 0 && (flip += "x");
            sy < 0 && (flip += " y") && (y = -1);
            s.flip = flip;
            o.coordorigin = (dx * -kx) + S + (dy * -ky);
            if (fillpos || _.fillsize) {
                var fill = o.getElementsByTagName(fillString);
                fill = fill && fill[0];
                o.removeChild(fill);
                if (fillpos) {
                    c = compensation(deg, m.x(fillpos[0], fillpos[1]), m.y(fillpos[0], fillpos[1]));
                    fill.position = c.dx * y + S + c.dy * y;
                }
                if (_.fillsize) {
                    fill.size = _.fillsize[0] * abs(sx) + S + _.fillsize[1] * abs(sy);
                }
                o.appendChild(fill);
            }
            s.visibility = "visible";
        };
    R.toString = function () {
        return  "Your browser doesn\u2019t support SVG. Falling down to VML.\nYou are running Rapha\xebl " + this.version;
    };
    var addArrow = function (o, value, isEnd) {
        var values = Str(value).toLowerCase().split("-"),
            se = isEnd ? "end" : "start",
            i = values.length,
            type = "classic",
            w = "medium",
            h = "medium";
        while (i--) {
            switch (values[i]) {
                case "block":
                case "classic":
                case "oval":
                case "diamond":
                case "open":
                case "none":
                    type = values[i];
                    break;
                case "wide":
                case "narrow": h = values[i]; break;
                case "long":
                case "short": w = values[i]; break;
            }
        }
        var stroke = o.node.getElementsByTagName("stroke")[0];
        stroke[se + "arrow"] = type;
        stroke[se + "arrowlength"] = w;
        stroke[se + "arrowwidth"] = h;
    },
    setFillAndStroke = function (o, params) {
        // o.paper.canvas.style.display = "none";
        o.attrs = o.attrs || {};
        var node = o.node,
            a = o.attrs,
            s = node.style,
            xy,
            newpath = pathTypes[o.type] && (params.x != a.x || params.y != a.y || params.width != a.width || params.height != a.height || params.cx != a.cx || params.cy != a.cy || params.rx != a.rx || params.ry != a.ry || params.r != a.r),
            isOval = ovalTypes[o.type] && (a.cx != params.cx || a.cy != params.cy || a.r != params.r || a.rx != params.rx || a.ry != params.ry),
            res = o;


        for (var par in params) if (params[has](par)) {
            a[par] = params[par];
        }
        if (newpath) {
            a.path = R._getPath[o.type](o);
            o._.dirty = 1;
        }
        params.href && (node.href = params.href);
        params.title && (node.title = params.title);
        params.target && (node.target = params.target);
        params.cursor && (s.cursor = params.cursor);
        "blur" in params && o.blur(params.blur);
        if (params.path && o.type == "path" || newpath) {
            node.path = path2vml(~Str(a.path).toLowerCase().indexOf("r") ? R._pathToAbsolute(a.path) : a.path);
            if (o.type == "image") {
                o._.fillpos = [a.x, a.y];
                o._.fillsize = [a.width, a.height];
                setCoords(o, 1, 1, 0, 0, 0);
            }
        }
        "transform" in params && o.transform(params.transform);
        if (isOval) {
            var cx = +a.cx,
                cy = +a.cy,
                rx = +a.rx || +a.r || 0,
                ry = +a.ry || +a.r || 0;
            node.path = R.format("ar{0},{1},{2},{3},{4},{1},{4},{1}x", round((cx - rx) * zoom), round((cy - ry) * zoom), round((cx + rx) * zoom), round((cy + ry) * zoom), round(cx * zoom));
            o._.dirty = 1;
        }
        if ("clip-rect" in params) {
            var rect = Str(params["clip-rect"]).split(separator);
            if (rect.length == 4) {
                rect[2] = +rect[2] + (+rect[0]);
                rect[3] = +rect[3] + (+rect[1]);
                var div = node.clipRect || R._g.doc.createElement("div"),
                    dstyle = div.style;
                dstyle.clip = R.format("rect({1}px {2}px {3}px {0}px)", rect);
                if (!node.clipRect) {
                    dstyle.position = "absolute";
                    dstyle.top = 0;
                    dstyle.left = 0;
                    dstyle.width = o.paper.width + "px";
                    dstyle.height = o.paper.height + "px";
                    node.parentNode.insertBefore(div, node);
                    div.appendChild(node);
                    node.clipRect = div;
                }
            }
            if (!params["clip-rect"]) {
                node.clipRect && (node.clipRect.style.clip = "auto");
            }
        }
        if (o.textpath) {
            var textpathStyle = o.textpath.style;
            params.font && (textpathStyle.font = params.font);
            params["font-family"] && (textpathStyle.fontFamily = '"' + params["font-family"].split(",")[0].replace(/^['"]+|['"]+$/g, E) + '"');
            params["font-size"] && (textpathStyle.fontSize = params["font-size"]);
            params["font-weight"] && (textpathStyle.fontWeight = params["font-weight"]);
            params["font-style"] && (textpathStyle.fontStyle = params["font-style"]);
        }
        if ("arrow-start" in params) {
            addArrow(res, params["arrow-start"]);
        }
        if ("arrow-end" in params) {
            addArrow(res, params["arrow-end"], 1);
        }
        if (params.opacity != null || 
            params["stroke-width"] != null ||
            params.fill != null ||
            params.src != null ||
            params.stroke != null ||
            params["stroke-width"] != null ||
            params["stroke-opacity"] != null ||
            params["fill-opacity"] != null ||
            params["stroke-dasharray"] != null ||
            params["stroke-miterlimit"] != null ||
            params["stroke-linejoin"] != null ||
            params["stroke-linecap"] != null) {
            var fill = node.getElementsByTagName(fillString),
                newfill = false;
            fill = fill && fill[0];
            !fill && (newfill = fill = createNode(fillString));
            if (o.type == "image" && params.src) {
                fill.src = params.src;
            }
            params.fill && (fill.on = true);
            if (fill.on == null || params.fill == "none" || params.fill === null) {
                fill.on = false;
            }
            if (fill.on && params.fill) {
                var isURL = Str(params.fill).match(R._ISURL);
                if (isURL) {
                    fill.parentNode == node && node.removeChild(fill);
                    fill.rotate = true;
                    fill.src = isURL[1];
                    fill.type = "tile";
                    var bbox = o.getBBox(1);
                    fill.position = bbox.x + S + bbox.y;
                    o._.fillpos = [bbox.x, bbox.y];

                    R._preload(isURL[1], function () {
                        o._.fillsize = [this.offsetWidth, this.offsetHeight];
                    });
                } else {
                    fill.color = R.getRGB(params.fill).hex;
                    fill.src = E;
                    fill.type = "solid";
                    if (R.getRGB(params.fill).error && (res.type in {circle: 1, ellipse: 1} || Str(params.fill).charAt() != "r") && addGradientFill(res, params.fill, fill)) {
                        a.fill = "none";
                        a.gradient = params.fill;
                        fill.rotate = false;
                    }
                }
            }
            if ("fill-opacity" in params || "opacity" in params) {
                var opacity = ((+a["fill-opacity"] + 1 || 2) - 1) * ((+a.opacity + 1 || 2) - 1) * ((+R.getRGB(params.fill).o + 1 || 2) - 1);
                opacity = mmin(mmax(opacity, 0), 1);
                fill.opacity = opacity;
                if (fill.src) {
                    fill.color = "none";
                }
            }
            node.appendChild(fill);
            var stroke = (node.getElementsByTagName("stroke") && node.getElementsByTagName("stroke")[0]),
            newstroke = false;
            !stroke && (newstroke = stroke = createNode("stroke"));
            if ((params.stroke && params.stroke != "none") ||
                params["stroke-width"] ||
                params["stroke-opacity"] != null ||
                params["stroke-dasharray"] ||
                params["stroke-miterlimit"] ||
                params["stroke-linejoin"] ||
                params["stroke-linecap"]) {
                stroke.on = true;
            }
            (params.stroke == "none" || params.stroke === null || stroke.on == null || params.stroke == 0 || params["stroke-width"] == 0) && (stroke.on = false);
            var strokeColor = R.getRGB(params.stroke);
            stroke.on && params.stroke && (stroke.color = strokeColor.hex);
            opacity = ((+a["stroke-opacity"] + 1 || 2) - 1) * ((+a.opacity + 1 || 2) - 1) * ((+strokeColor.o + 1 || 2) - 1);
            var width = (toFloat(params["stroke-width"]) || 1) * .75;
            opacity = mmin(mmax(opacity, 0), 1);
            params["stroke-width"] == null && (width = a["stroke-width"]);
            params["stroke-width"] && (stroke.weight = width);
            width && width < 1 && (opacity *= width) && (stroke.weight = 1);
            stroke.opacity = opacity;
        
            params["stroke-linejoin"] && (stroke.joinstyle = params["stroke-linejoin"] || "miter");
            stroke.miterlimit = params["stroke-miterlimit"] || 8;
            params["stroke-linecap"] && (stroke.endcap = params["stroke-linecap"] == "butt" ? "flat" : params["stroke-linecap"] == "square" ? "square" : "round");
            if (params["stroke-dasharray"]) {
                var dasharray = {
                    "-": "shortdash",
                    ".": "shortdot",
                    "-.": "shortdashdot",
                    "-..": "shortdashdotdot",
                    ". ": "dot",
                    "- ": "dash",
                    "--": "longdash",
                    "- .": "dashdot",
                    "--.": "longdashdot",
                    "--..": "longdashdotdot"
                };
                stroke.dashstyle = dasharray[has](params["stroke-dasharray"]) ? dasharray[params["stroke-dasharray"]] : E;
            }
            newstroke && node.appendChild(stroke);
        }
        if (res.type == "text") {
            res.paper.canvas.style.display = E;
            var span = res.paper.span,
                m = 100,
                fontSize = a.font && a.font.match(/\d+(?:\.\d*)?(?=px)/);
            s = span.style;
            a.font && (s.font = a.font);
            a["font-family"] && (s.fontFamily = a["font-family"]);
            a["font-weight"] && (s.fontWeight = a["font-weight"]);
            a["font-style"] && (s.fontStyle = a["font-style"]);
            fontSize = toFloat(a["font-size"] || fontSize && fontSize[0]) || 10;
            s.fontSize = fontSize * m + "px";
            res.textpath.string && (span.innerHTML = Str(res.textpath.string).replace(/</g, "&#60;").replace(/&/g, "&#38;").replace(/\n/g, "<br>"));
            var brect = span.getBoundingClientRect();
            res.W = a.w = (brect.right - brect.left) / m;
            res.H = a.h = (brect.bottom - brect.top) / m;
            // res.paper.canvas.style.display = "none";
            res.X = a.x;
            res.Y = a.y + res.H / 2;

            ("x" in params || "y" in params) && (res.path.v = R.format("m{0},{1}l{2},{1}", round(a.x * zoom), round(a.y * zoom), round(a.x * zoom) + 1));
            var dirtyattrs = ["x", "y", "text", "font", "font-family", "font-weight", "font-style", "font-size"];
            for (var d = 0, dd = dirtyattrs.length; d < dd; d++) if (dirtyattrs[d] in params) {
                res._.dirty = 1;
                break;
            }
        
            // text-anchor emulation
            switch (a["text-anchor"]) {
                case "start":
                    res.textpath.style["v-text-align"] = "left";
                    res.bbx = res.W / 2;
                break;
                case "end":
                    res.textpath.style["v-text-align"] = "right";
                    res.bbx = -res.W / 2;
                break;
                default:
                    res.textpath.style["v-text-align"] = "center";
                    res.bbx = 0;
                break;
            }
            res.textpath.style["v-text-kern"] = true;
        }
        // res.paper.canvas.style.display = E;
    },
    addGradientFill = function (o, gradient, fill) {
        o.attrs = o.attrs || {};
        var attrs = o.attrs,
            pow = Math.pow,
            opacity,
            oindex,
            type = "linear",
            fxfy = ".5 .5";
        o.attrs.gradient = gradient;
        gradient = Str(gradient).replace(R._radial_gradient, function (all, fx, fy) {
            type = "radial";
            if (fx && fy) {
                fx = toFloat(fx);
                fy = toFloat(fy);
                pow(fx - .5, 2) + pow(fy - .5, 2) > .25 && (fy = math.sqrt(.25 - pow(fx - .5, 2)) * ((fy > .5) * 2 - 1) + .5);
                fxfy = fx + S + fy;
            }
            return E;
        });
        gradient = gradient.split(/\s*\-\s*/);
        if (type == "linear") {
            var angle = gradient.shift();
            angle = -toFloat(angle);
            if (isNaN(angle)) {
                return null;
            }
        }
        var dots = R._parseDots(gradient);
        if (!dots) {
            return null;
        }
        o = o.shape || o.node;
        if (dots.length) {
            o.removeChild(fill);
            fill.on = true;
            fill.method = "none";
            fill.color = dots[0].color;
            fill.color2 = dots[dots.length - 1].color;
            var clrs = [];
            for (var i = 0, ii = dots.length; i < ii; i++) {
                dots[i].offset && clrs.push(dots[i].offset + S + dots[i].color);
            }
            fill.colors = clrs.length ? clrs.join() : "0% " + fill.color;
            if (type == "radial") {
                fill.type = "gradientTitle";
                fill.focus = "100%";
                fill.focussize = "0 0";
                fill.focusposition = fxfy;
                fill.angle = 0;
            } else {
                // fill.rotate= true;
                fill.type = "gradient";
                fill.angle = (270 - angle) % 360;
            }
            o.appendChild(fill);
        }
        return 1;
    },
    Element = function (node, vml) {
        this[0] = this.node = node;
        node.raphael = true;
        this.id = R._oid++;
        node.raphaelid = this.id;
        this.X = 0;
        this.Y = 0;
        this.attrs = {};
        this.paper = vml;
        this.matrix = R.matrix();
        this._ = {
            transform: [],
            sx: 1,
            sy: 1,
            dx: 0,
            dy: 0,
            deg: 0,
            dirty: 1,
            dirtyT: 1
        };
        !vml.bottom && (vml.bottom = this);
        this.prev = vml.top;
        vml.top && (vml.top.next = this);
        vml.top = this;
        this.next = null;
    };
    var elproto = R.el;

    Element.prototype = elproto;
    elproto.constructor = Element;
    elproto.transform = function (tstr) {
        if (tstr == null) {
            return this._.transform;
        }
        var vbs = this.paper._viewBoxShift,
            vbt = vbs ? "s" + [vbs.scale, vbs.scale] + "-1-1t" + [vbs.dx, vbs.dy] : E,
            oldt;
        if (vbs) {
            oldt = tstr = Str(tstr).replace(/\.{3}|\u2026/g, this._.transform || E);
        }
        R._extractTransform(this, vbt + tstr);
        var matrix = this.matrix.clone(),
            skew = this.skew,
            o = this.node,
            split,
            isGrad = ~Str(this.attrs.fill).indexOf("-"),
            isPatt = !Str(this.attrs.fill).indexOf("url(");
        matrix.translate(1, 1);
        if (isPatt || isGrad || this.type == "image") {
            skew.matrix = "1 0 0 1";
            skew.offset = "0 0";
            split = matrix.split();
            if ((isGrad && split.noRotation) || !split.isSimple) {
                o.style.filter = matrix.toFilter();
                var bb = this.getBBox(),
                    bbt = this.getBBox(1),
                    dx = bb.x - bbt.x,
                    dy = bb.y - bbt.y;
                o.coordorigin = (dx * -zoom) + S + (dy * -zoom);
                setCoords(this, 1, 1, dx, dy, 0);
            } else {
                o.style.filter = E;
                setCoords(this, split.scalex, split.scaley, split.dx, split.dy, split.rotate);
            }
        } else {
            o.style.filter = E;
            skew.matrix = Str(matrix);
            skew.offset = matrix.offset();
        }
        oldt && (this._.transform = oldt);
        return this;
    };
    elproto.rotate = function (deg, cx, cy) {
        if (this.removed) {
            return this;
        }
        if (deg == null) {
            return;
        }
        deg = Str(deg).split(separator);
        if (deg.length - 1) {
            cx = toFloat(deg[1]);
            cy = toFloat(deg[2]);
        }
        deg = toFloat(deg[0]);
        (cy == null) && (cx = cy);
        if (cx == null || cy == null) {
            var bbox = this.getBBox(1);
            cx = bbox.x + bbox.width / 2;
            cy = bbox.y + bbox.height / 2;
        }
        this._.dirtyT = 1;
        this.transform(this._.transform.concat([["r", deg, cx, cy]]));
        return this;
    };
    elproto.translate = function (dx, dy) {
        if (this.removed) {
            return this;
        }
        dx = Str(dx).split(separator);
        if (dx.length - 1) {
            dy = toFloat(dx[1]);
        }
        dx = toFloat(dx[0]) || 0;
        dy = +dy || 0;
        if (this._.bbox) {
            this._.bbox.x += dx;
            this._.bbox.y += dy;
        }
        this.transform(this._.transform.concat([["t", dx, dy]]));
        return this;
    };
    elproto.scale = function (sx, sy, cx, cy) {
        if (this.removed) {
            return this;
        }
        sx = Str(sx).split(separator);
        if (sx.length - 1) {
            sy = toFloat(sx[1]);
            cx = toFloat(sx[2]);
            cy = toFloat(sx[3]);
            isNaN(cx) && (cx = null);
            isNaN(cy) && (cy = null);
        }
        sx = toFloat(sx[0]);
        (sy == null) && (sy = sx);
        (cy == null) && (cx = cy);
        if (cx == null || cy == null) {
            var bbox = this.getBBox(1);
        }
        cx = cx == null ? bbox.x + bbox.width / 2 : cx;
        cy = cy == null ? bbox.y + bbox.height / 2 : cy;
    
        this.transform(this._.transform.concat([["s", sx, sy, cx, cy]]));
        this._.dirtyT = 1;
        return this;
    };
    elproto.hide = function () {
        !this.removed && (this.node.style.display = "none");
        return this;
    };
    elproto.show = function () {
        !this.removed && (this.node.style.display = E);
        return this;
    };
    elproto._getBBox = function () {
        if (this.removed) {
            return {};
        }
        return {
            x: this.X + (this.bbx || 0) - this.W / 2,
            y: this.Y - this.H,
            width: this.W,
            height: this.H
        };
    };
    elproto.remove = function () {
        if (this.removed || !this.node.parentNode) {
            return;
        }
        this.paper.__set__ && this.paper.__set__.exclude(this);
        R.eve.unbind("raphael.*.*." + this.id);
        R._tear(this, this.paper);
        this.node.parentNode.removeChild(this.node);
        this.shape && this.shape.parentNode.removeChild(this.shape);
        for (var i in this) {
            this[i] = typeof this[i] == "function" ? R._removedFactory(i) : null;
        }
        this.removed = true;
    };
    elproto.attr = function (name, value) {
        if (this.removed) {
            return this;
        }
        if (name == null) {
            var res = {};
            for (var a in this.attrs) if (this.attrs[has](a)) {
                res[a] = this.attrs[a];
            }
            res.gradient && res.fill == "none" && (res.fill = res.gradient) && delete res.gradient;
            res.transform = this._.transform;
            return res;
        }
        if (value == null && R.is(name, "string")) {
            if (name == fillString && this.attrs.fill == "none" && this.attrs.gradient) {
                return this.attrs.gradient;
            }
            var names = name.split(separator),
                out = {};
            for (var i = 0, ii = names.length; i < ii; i++) {
                name = names[i];
                if (name in this.attrs) {
                    out[name] = this.attrs[name];
                } else if (R.is(this.paper.customAttributes[name], "function")) {
                    out[name] = this.paper.customAttributes[name].def;
                } else {
                    out[name] = R._availableAttrs[name];
                }
            }
            return ii - 1 ? out : out[names[0]];
        }
        if (this.attrs && value == null && R.is(name, "array")) {
            out = {};
            for (i = 0, ii = name.length; i < ii; i++) {
                out[name[i]] = this.attr(name[i]);
            }
            return out;
        }
        var params;
        if (value != null) {
            params = {};
            params[name] = value;
        }
        value == null && R.is(name, "object") && (params = name);
        for (var key in params) {
            eve("raphael.attr." + key + "." + this.id, this, params[key]);
        }
        if (params) {
            for (key in this.paper.customAttributes) if (this.paper.customAttributes[has](key) && params[has](key) && R.is(this.paper.customAttributes[key], "function")) {
                var par = this.paper.customAttributes[key].apply(this, [].concat(params[key]));
                this.attrs[key] = params[key];
                for (var subkey in par) if (par[has](subkey)) {
                    params[subkey] = par[subkey];
                }
            }
            // this.paper.canvas.style.display = "none";
            if (params.text && this.type == "text") {
                this.textpath.string = params.text;
            }
            setFillAndStroke(this, params);
            // this.paper.canvas.style.display = E;
        }
        return this;
    };
    elproto.toFront = function () {
        !this.removed && this.node.parentNode.appendChild(this.node);
        this.paper && this.paper.top != this && R._tofront(this, this.paper);
        return this;
    };
    elproto.toBack = function () {
        if (this.removed) {
            return this;
        }
        if (this.node.parentNode.firstChild != this.node) {
            this.node.parentNode.insertBefore(this.node, this.node.parentNode.firstChild);
            R._toback(this, this.paper);
        }
        return this;
    };
    elproto.insertAfter = function (element) {
        if (this.removed) {
            return this;
        }
        if (element.constructor == R.st.constructor) {
            element = element[element.length - 1];
        }
        if (element.node.nextSibling) {
            element.node.parentNode.insertBefore(this.node, element.node.nextSibling);
        } else {
            element.node.parentNode.appendChild(this.node);
        }
        R._insertafter(this, element, this.paper);
        return this;
    };
    elproto.insertBefore = function (element) {
        if (this.removed) {
            return this;
        }
        if (element.constructor == R.st.constructor) {
            element = element[0];
        }
        element.node.parentNode.insertBefore(this.node, element.node);
        R._insertbefore(this, element, this.paper);
        return this;
    };
    elproto.blur = function (size) {
        var s = this.node.runtimeStyle,
            f = s.filter;
        f = f.replace(blurregexp, E);
        if (+size !== 0) {
            this.attrs.blur = size;
            s.filter = f + S + ms + ".Blur(pixelradius=" + (+size || 1.5) + ")";
            s.margin = R.format("-{0}px 0 0 -{0}px", round(+size || 1.5));
        } else {
            s.filter = f;
            s.margin = 0;
            delete this.attrs.blur;
        }
        return this;
    };

    R._engine.path = function (pathString, vml) {
        var el = createNode("shape");
        el.style.cssText = cssDot;
        el.coordsize = zoom + S + zoom;
        el.coordorigin = vml.coordorigin;
        var p = new Element(el, vml),
            attr = {fill: "none", stroke: "#000"};
        pathString && (attr.path = pathString);
        p.type = "path";
        p.path = [];
        p.Path = E;
        setFillAndStroke(p, attr);
        vml.canvas.appendChild(el);
        var skew = createNode("skew");
        skew.on = true;
        el.appendChild(skew);
        p.skew = skew;
        p.transform(E);
        return p;
    };
    R._engine.rect = function (vml, x, y, w, h, r) {
        var path = R._rectPath(x, y, w, h, r),
            res = vml.path(path),
            a = res.attrs;
        res.X = a.x = x;
        res.Y = a.y = y;
        res.W = a.width = w;
        res.H = a.height = h;
        a.r = r;
        a.path = path;
        res.type = "rect";
        return res;
    };
    R._engine.ellipse = function (vml, x, y, rx, ry) {
        var res = vml.path(),
            a = res.attrs;
        res.X = x - rx;
        res.Y = y - ry;
        res.W = rx * 2;
        res.H = ry * 2;
        res.type = "ellipse";
        setFillAndStroke(res, {
            cx: x,
            cy: y,
            rx: rx,
            ry: ry
        });
        return res;
    };
    R._engine.circle = function (vml, x, y, r) {
        var res = vml.path(),
            a = res.attrs;
        res.X = x - r;
        res.Y = y - r;
        res.W = res.H = r * 2;
        res.type = "circle";
        setFillAndStroke(res, {
            cx: x,
            cy: y,
            r: r
        });
        return res;
    };
    R._engine.image = function (vml, src, x, y, w, h) {
        var path = R._rectPath(x, y, w, h),
            res = vml.path(path).attr({stroke: "none"}),
            a = res.attrs,
            node = res.node,
            fill = node.getElementsByTagName(fillString)[0];
        a.src = src;
        res.X = a.x = x;
        res.Y = a.y = y;
        res.W = a.width = w;
        res.H = a.height = h;
        a.path = path;
        res.type = "image";
        fill.parentNode == node && node.removeChild(fill);
        fill.rotate = true;
        fill.src = src;
        fill.type = "tile";
        res._.fillpos = [x, y];
        res._.fillsize = [w, h];
        node.appendChild(fill);
        setCoords(res, 1, 1, 0, 0, 0);
        return res;
    };
    R._engine.text = function (vml, x, y, text) {
        var el = createNode("shape"),
            path = createNode("path"),
            o = createNode("textpath");
        x = x || 0;
        y = y || 0;
        text = text || "";
        path.v = R.format("m{0},{1}l{2},{1}", round(x * zoom), round(y * zoom), round(x * zoom) + 1);
        path.textpathok = true;
        o.string = Str(text);
        o.on = true;
        el.style.cssText = cssDot;
        el.coordsize = zoom + S + zoom;
        el.coordorigin = "0 0";
        var p = new Element(el, vml),
            attr = {
                fill: "#000",
                stroke: "none",
                font: R._availableAttrs.font,
                text: text
            };
        p.shape = el;
        p.path = path;
        p.textpath = o;
        p.type = "text";
        p.attrs.text = Str(text);
        p.attrs.x = x;
        p.attrs.y = y;
        p.attrs.w = 1;
        p.attrs.h = 1;
        setFillAndStroke(p, attr);
        el.appendChild(o);
        el.appendChild(path);
        vml.canvas.appendChild(el);
        var skew = createNode("skew");
        skew.on = true;
        el.appendChild(skew);
        p.skew = skew;
        p.transform(E);
        return p;
    };
    R._engine.setSize = function (width, height) {
        var cs = this.canvas.style;
        this.width = width;
        this.height = height;
        width == +width && (width += "px");
        height == +height && (height += "px");
        cs.width = width;
        cs.height = height;
        cs.clip = "rect(0 " + width + " " + height + " 0)";
        if (this._viewBox) {
            R._engine.setViewBox.apply(this, this._viewBox);
        }
        return this;
    };
    R._engine.setViewBox = function (x, y, w, h, fit) {
        R.eve("raphael.setViewBox", this, this._viewBox, [x, y, w, h, fit]);
        var width = this.width,
            height = this.height,
            size = 1 / mmax(w / width, h / height),
            H, W;
        if (fit) {
            H = height / h;
            W = width / w;
            if (w * H < width) {
                x -= (width - w * H) / 2 / H;
            }
            if (h * W < height) {
                y -= (height - h * W) / 2 / W;
            }
        }
        this._viewBox = [x, y, w, h, !!fit];
        this._viewBoxShift = {
            dx: -x,
            dy: -y,
            scale: size
        };
        this.forEach(function (el) {
            el.transform("...");
        });
        return this;
    };
    var createNode;
    R._engine.initWin = function (win) {
            var doc = win.document;
            doc.createStyleSheet().addRule(".rvml", "behavior:url(#default#VML)");
            try {
                !doc.namespaces.rvml && doc.namespaces.add("rvml", "urn:schemas-microsoft-com:vml");
                createNode = function (tagName) {
                    return doc.createElement('<rvml:' + tagName + ' class="rvml">');
                };
            } catch (e) {
                createNode = function (tagName) {
                    return doc.createElement('<' + tagName + ' xmlns="urn:schemas-microsoft.com:vml" class="rvml">');
                };
            }
        };
    R._engine.initWin(R._g.win);
    R._engine.create = function () {
        var con = R._getContainer.apply(0, arguments),
            container = con.container,
            height = con.height,
            s,
            width = con.width,
            x = con.x,
            y = con.y;
        if (!container) {
            throw new Error("VML container not found.");
        }
        var res = new R._Paper,
            c = res.canvas = R._g.doc.createElement("div"),
            cs = c.style;
        x = x || 0;
        y = y || 0;
        width = width || 512;
        height = height || 342;
        res.width = width;
        res.height = height;
        width == +width && (width += "px");
        height == +height && (height += "px");
        res.coordsize = zoom * 1e3 + S + zoom * 1e3;
        res.coordorigin = "0 0";
        res.span = R._g.doc.createElement("span");
        res.span.style.cssText = "position:absolute;left:-9999em;top:-9999em;padding:0;margin:0;line-height:1;";
        c.appendChild(res.span);
        cs.cssText = R.format("top:0;left:0;width:{0};height:{1};display:inline-block;position:relative;clip:rect(0 {0} {1} 0);overflow:hidden", width, height);
        if (container == 1) {
            R._g.doc.body.appendChild(c);
            cs.left = x + "px";
            cs.top = y + "px";
            cs.position = "absolute";
        } else {
            if (container.firstChild) {
                container.insertBefore(c, container.firstChild);
            } else {
                container.appendChild(c);
            }
        }
        res.renderfix = function () {};
        return res;
    };
    R.prototype.clear = function () {
        R.eve("raphael.clear", this);
        this.canvas.innerHTML = E;
        this.span = R._g.doc.createElement("span");
        this.span.style.cssText = "position:absolute;left:-9999em;top:-9999em;padding:0;margin:0;line-height:1;display:inline;";
        this.canvas.appendChild(this.span);
        this.bottom = this.top = null;
    };
    R.prototype.remove = function () {
        R.eve("raphael.remove", this);
        this.canvas.parentNode.removeChild(this.canvas);
        for (var i in this) {
            this[i] = typeof this[i] == "function" ? R._removedFactory(i) : null;
        }
        return true;
    };

    var setproto = R.st;
    for (var method in elproto) if (elproto[has](method) && !setproto[has](method)) {
        setproto[method] = (function (methodname) {
            return function () {
                var arg = arguments;
                return this.forEach(function (el) {
                    el[methodname].apply(el, arg);
                });
            };
        })(method);
    }
})();

    // EXPOSE
    // SVG and VML are appended just before the EXPOSE line
    // Even with AMD, Raphael should be defined globally
    oldRaphael.was ? (g.win.Raphael = R) : (Raphael = R);

    return R;
}));

/**
 * VexFlow Engraver 1.2 Custom
 * A library for rendering musical notation and guitar tablature in HTML5.
 *
 *                    http://www.vexflow.com
 *
 * Copyright (c) 2010 Mohit Muthanna Cheppudira <mohit@muthanna.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 *
 * This library makes use of Simon Tatham's awesome font - Gonville.
 *
 * Build ID: 0xFE@1dfaadf84a7b1d49468872116367b384490ea93d
 * Build date: 2014-10-23 14:43:54 +0900
 */
function Vex(){}Vex.L=function(e,t){if(t){var r=Array.prototype.slice.call(t).join(" ");window.console.log(e+": "+r)}},Vex.RuntimeError=function(e,t){this.code=e,this.message=t},Vex.RuntimeError.prototype.toString=function(){return"RuntimeError: "+this.message},Vex.RERR=Vex.RuntimeError,Vex.Merge=function(e,t){for(var r in t)e[r]=t[r];return e},Vex.Min=function(e,t){return e>t?t:e},Vex.Max=function(e,t){return e>t?e:t},Vex.RoundN=function(e,t){return e%t>=t/2?parseInt(e/t,10)*t+t:parseInt(e/t,10)*t},Vex.MidLine=function(e,t){var r=t+(e-t)/2;return r%2>0&&(r=Vex.RoundN(10*r,5)/10),r},Vex.SortAndUnique=function(e,t,r){if(e.length>1){var n,o=[];e.sort(t);for(var i=0;i<e.length;++i)0!==i&&r(e[i],n)||o.push(e[i]),n=e[i];return o}return e},Vex.Contains=function(e,t){for(var r=e.length;r--;)if(e[r]===t)return!0;return!1},Vex.getCanvasContext=function(e){if(!e)throw new Vex.RERR("BadArgument","Invalid canvas selector: "+e);var t=document.getElementById(e);if(!t||!t.getContext)throw new Vex.RERR("UnsupportedBrowserError","This browser does not support HTML5 Canvas");return t.getContext("2d")},Vex.drawDot=function(e,t,r,n){var o=n||"#f55";e.save(),e.fillStyle=o,e.beginPath(),e.arc(t,r,3,0,2*Math.PI,!0),e.closePath(),e.fill(),e.restore()},Vex.BM=function(e,t){var r=(new Date).getTime();t();var n=(new Date).getTime()-r;Vex.L(e+n+"ms")},Vex.Inherit=function(){var e=function(){};return function(t,r,n){return e.prototype=r.prototype,t.prototype=new e,t.superclass=r.prototype,t.prototype.constructor=t,Vex.Merge(t.prototype,n),t}}();Vex.Flow={RESOLUTION:16384,IsKerned:!0};Vex.Flow.Fraction=function(){function t(t,n){this.set(t,n)}return t.GCD=function(t,n){if("number"!=typeof t||"number"!=typeof n)throw new Vex.RERR("BadArgument","Invalid numbers: "+t+", "+n);for(var r;0!==n;)r=n,n=t%n,t=r;return t},t.LCM=function(n,r){return n*r/t.GCD(n,r)},t.LCMM=function(n){if(0===n.length)return 0;if(1==n.length)return n[0];if(2==n.length)return Vex.Flow.Fraction.LCM(n[0],n[1]);var r=n[0];return n.shift(),t.LCM(r,Vex.Flow.Fraction.LCMM(n))},t.prototype={set:function(t,n){return this.numerator=void 0===t?1:t,this.denominator=void 0===n?1:n,this},value:function(){return this.numerator/this.denominator},simplify:function(){var t=this.numerator,n=this.denominator,r=Vex.Flow.Fraction.GCD(t,n);return t/=r,n/=r,0>n&&(n=-n,t=-t),this.set(t,n)},add:function(t,n){var r,o;t instanceof Vex.Flow.Fraction?(r=t.numerator,o=t.denominator):(r=void 0!==t?t:0,o=void 0!==n?n:1);var i=Vex.Flow.Fraction.LCM(this.denominator,o),e=i/this.denominator,a=i/o,u=this.numerator*e+r*a;return this.set(u,i)},subtract:function(t,n){var r,o;t instanceof Vex.Flow.Fraction?(r=t.numerator,o=t.denominator):(r=void 0!==t?t:0,o=void 0!==n?n:1);var i=Vex.Flow.Fraction.LCM(this.denominator,o),e=i/this.denominator,a=i/o,u=this.numerator*e-r*a;return this.set(u,i)},multiply:function(t,n){var r,o;return t instanceof Vex.Flow.Fraction?(r=t.numerator,o=t.denominator):(r=void 0!==t?t:1,o=void 0!==n?n:1),this.set(this.numerator*r,this.denominator*o)},divide:function(t,n){var r,o;return t instanceof Vex.Flow.Fraction?(r=t.numerator,o=t.denominator):(r=void 0!==t?t:1,o=void 0!==n?n:1),this.set(this.numerator*o,this.denominator*r)},equals:function(t){var n=Vex.Flow.Fraction.__compareA.copy(t).simplify(),r=Vex.Flow.Fraction.__compareB.copy(this).simplify();return n.numerator===r.numerator&&n.denominator===r.denominator},greaterThan:function(t){var n=Vex.Flow.Fraction.__compareB.copy(this);return n.subtract(t),n.numerator>0},greaterThanEquals:function(t){var n=Vex.Flow.Fraction.__compareB.copy(this);return n.subtract(t),n.numerator>=0},lessThan:function(t){return!this.greaterThanEquals(t)},lessThanEquals:function(t){return!this.greaterThan(t)},clone:function(){return new Vex.Flow.Fraction(this.numerator,this.denominator)},copy:function(t){return this.set(t.numerator,t.denominator)},quotient:function(){return Math.floor(this.numerator/this.denominator)},fraction:function(){return this.numerator%this.denominator},abs:function(){return this.denominator=Math.abs(this.denominator),this.numerator=Math.abs(this.numerator),this},toString:function(){return this.numerator+"/"+this.denominator},toSimplifiedString:function(){return Vex.Flow.Fraction.__tmp.copy(this).simplify().toString()},toMixedString:function(){var t="",n=this.quotient(),r=Vex.Flow.Fraction.__tmp.copy(this);return 0>n?r.abs().fraction():r.fraction(),0!==n?(t+=n,0!==r.numerator&&(t+=" "+r.toSimplifiedString())):t=0===r.numerator?"0":r.toSimplifiedString(),t},parse:function(t){var n=t.split("/"),r=parseInt(n[0],10),o=n[1]?parseInt(n[1],10):1;return this.set(r,o)}},t.__compareA=new t,t.__compareB=new t,t.__tmp=new t,t}();function sanitizeDuration(e){var t=Vex.Flow.durationAliases[e];if(void 0!==t&&(e=t),void 0===Vex.Flow.durationToTicks.durations[e])throw new Vex.RERR("BadArguments","The provided duration is not valid");return e}Vex.Flow.STEM_WIDTH=1.5,Vex.Flow.STEM_HEIGHT=32,Vex.Flow.STAVE_LINE_THICKNESS=2,Vex.Flow.clefProperties=function(e){if(!e)throw new Vex.RERR("BadArgument","Invalid clef: "+e);var t=Vex.Flow.clefProperties.values[e];if(!t)throw new Vex.RERR("BadArgument","Invalid clef: "+e);return t},Vex.Flow.clefProperties.values={treble:{line_shift:0},bass:{line_shift:6},tenor:{line_shift:4},alto:{line_shift:3},soprano:{line_shift:1},percussion:{line_shift:0},"mezzo-soprano":{line_shift:2},"baritone-c":{line_shift:5},"baritone-f":{line_shift:5},subbass:{line_shift:7},french:{line_shift:-1}},Vex.Flow.keyProperties=function(e,t,n){void 0===t&&(t="treble");var i={octave_shift:0};"object"==typeof n&&Vex.Merge(i,n);var o=e.split("/");if(o.length<2)throw new Vex.RERR("BadArguments","Key must have note + octave and an optional glyph: "+e);var a=o[0].toUpperCase(),d=Vex.Flow.keyProperties.note_values[a];if(!d)throw new Vex.RERR("BadArguments","Invalid key name: "+a);d.octave&&(o[1]=d.octave);var _=parseInt(o[1]);_+=-1*i.octave_shift;var s=7*_-28,h=(s+d.index)/2;h+=Vex.Flow.clefProperties(t).line_shift;var l=0;0>=h&&2*h%2===0&&(l=1),h>=6&&2*h%2===0&&(l=-1);var c="undefined"!=typeof d.int_val?12*_+d.int_val:null,r=d.code,f=d.shift_right;if(o.length>2&&o[2]){var w=o[2].toUpperCase(),u=Vex.Flow.keyProperties.note_glyph[w];u&&(r=u.code,f=u.shift_right)}return{key:a,octave:_,line:h,int_value:c,accidental:d.accidental,code:r,stroke:l,shift_right:f,displaced:!1}},Vex.Flow.keyProperties.note_values={C:{index:0,int_val:0,accidental:null},CN:{index:0,int_val:0,accidental:"n"},"C#":{index:0,int_val:1,accidental:"#"},"C##":{index:0,int_val:2,accidental:"##"},CB:{index:0,int_val:-1,accidental:"b"},CBB:{index:0,int_val:-2,accidental:"bb"},D:{index:1,int_val:2,accidental:null},DN:{index:1,int_val:2,accidental:"n"},"D#":{index:1,int_val:3,accidental:"#"},"D##":{index:1,int_val:4,accidental:"##"},DB:{index:1,int_val:1,accidental:"b"},DBB:{index:1,int_val:0,accidental:"bb"},E:{index:2,int_val:4,accidental:null},EN:{index:2,int_val:4,accidental:"n"},"E#":{index:2,int_val:5,accidental:"#"},"E##":{index:2,int_val:6,accidental:"##"},EB:{index:2,int_val:3,accidental:"b"},EBB:{index:2,int_val:2,accidental:"bb"},F:{index:3,int_val:5,accidental:null},FN:{index:3,int_val:5,accidental:"n"},"F#":{index:3,int_val:6,accidental:"#"},"F##":{index:3,int_val:7,accidental:"##"},FB:{index:3,int_val:4,accidental:"b"},FBB:{index:3,int_val:3,accidental:"bb"},G:{index:4,int_val:7,accidental:null},GN:{index:4,int_val:7,accidental:"n"},"G#":{index:4,int_val:8,accidental:"#"},"G##":{index:4,int_val:9,accidental:"##"},GB:{index:4,int_val:6,accidental:"b"},GBB:{index:4,int_val:5,accidental:"bb"},A:{index:5,int_val:9,accidental:null},AN:{index:5,int_val:9,accidental:"n"},"A#":{index:5,int_val:10,accidental:"#"},"A##":{index:5,int_val:11,accidental:"##"},AB:{index:5,int_val:8,accidental:"b"},ABB:{index:5,int_val:7,accidental:"bb"},B:{index:6,int_val:11,accidental:null},BN:{index:6,int_val:11,accidental:"n"},"B#":{index:6,int_val:12,accidental:"#"},"B##":{index:6,int_val:13,accidental:"##"},BB:{index:6,int_val:10,accidental:"b"},BBB:{index:6,int_val:9,accidental:"bb"},R:{index:6,int_val:9,rest:!0},X:{index:6,accidental:"",octave:4,code:"v3e",shift_right:5.5}},Vex.Flow.keyProperties.note_glyph={D0:{code:"v27",shift_right:-.5},D1:{code:"v2d",shift_right:-.5},D2:{code:"v22",shift_right:-.5},D3:{code:"v70",shift_right:-.5},T0:{code:"v49",shift_right:-2},T1:{code:"v93",shift_right:.5},T2:{code:"v40",shift_right:.5},T3:{code:"v7d",shift_right:.5},X0:{code:"v92",shift_right:-2},X1:{code:"v95",shift_right:-.5},X2:{code:"v7f",shift_right:.5},X3:{code:"v3b",shift_right:-2}},Vex.Flow.integerToNote=function(e){if("undefined"==typeof e)throw new Vex.RERR("BadArguments","Undefined integer for integerToNote");if(-2>e)throw new Vex.RERR("BadArguments","integerToNote requires integer > -2: "+e);var t=Vex.Flow.integerToNote.table[e];if(!t)throw new Vex.RERR("BadArguments","Unknown note value for integer: "+e);return t},Vex.Flow.integerToNote.table={0:"C",1:"C#",2:"D",3:"D#",4:"E",5:"F",6:"F#",7:"G",8:"G#",9:"A",10:"A#",11:"B"},Vex.Flow.tabToGlyph=function(e){var t=null,n=0,i=0;return"X"==e.toString().toUpperCase()?(t="v7f",n=7,i=-4.5):n=Vex.Flow.textWidth(e.toString()),{text:e,code:t,width:n,shift_y:i}},Vex.Flow.textWidth=function(e){return 6*e.toString().length},Vex.Flow.articulationCodes=function(e){return Vex.Flow.articulationCodes.articulations[e]},Vex.Flow.articulationCodes.articulations={"a.":{code:"v23",width:4,shift_right:-2,shift_up:8,shift_down:0,between_lines:!0},av:{code:"v28",width:4,shift_right:0,shift_up:11,shift_down:5,between_lines:!0},"a>":{code:"v42",width:10,shift_right:5,shift_up:8,shift_down:1,between_lines:!0},"a-":{code:"v25",width:9,shift_right:-4,shift_up:17,shift_down:10,between_lines:!0},"a^":{code:"va",width:8,shift_right:0,shift_up:-4,shift_down:-2,between_lines:!1},"a+":{code:"v8b",width:9,shift_right:-4,shift_up:12,shift_down:12,between_lines:!1},ao:{code:"v94",width:8,shift_right:0,shift_up:-4,shift_down:6,between_lines:!1},ah:{code:"vb9",width:7,shift_right:0,shift_up:-4,shift_down:4,between_lines:!1},"a@a":{code:"v43",width:25,shift_right:0,shift_up:8,shift_down:10,between_lines:!1},"a@u":{code:"v5b",width:25,shift_right:0,shift_up:0,shift_down:-4,between_lines:!1},"a|":{code:"v75",width:8,shift_right:0,shift_up:8,shift_down:10,between_lines:!1},am:{code:"v97",width:13,shift_right:0,shift_up:10,shift_down:12,between_lines:!1},"a,":{code:"vb3",width:6,shift_right:8,shift_up:-4,shift_down:4,between_lines:!1}},Vex.Flow.accidentalCodes=function(e){return Vex.Flow.accidentalCodes.accidentals[e]},Vex.Flow.accidentalCodes.accidentals={"#":{code:"v18",width:10,gracenote_width:4.5,shift_right:0,shift_down:0},"##":{code:"v7f",width:13,gracenote_width:6,shift_right:-1,shift_down:0},b:{code:"v44",width:8,gracenote_width:4.5,shift_right:0,shift_down:0},bb:{code:"v26",width:14,gracenote_width:8,shift_right:-3,shift_down:0},n:{code:"v4e",width:8,gracenote_width:4.5,shift_right:0,shift_down:0},"{":{code:"v9c",width:5,shift_right:2,shift_down:0},"}":{code:"v84",width:5,shift_right:0,shift_down:0},db:{code:"v9e",width:16,shift_right:0,shift_down:0},d:{code:"vab",width:10,shift_right:0,shift_down:0},bbs:{code:"v90",width:13,shift_right:0,shift_down:0},"++":{code:"v51",width:13,shift_right:0,shift_down:0},"+":{code:"v78",width:8,shift_right:0,shift_down:0}},Vex.Flow.ornamentCodes=function(e){return Vex.Flow.ornamentCodes.ornaments[e]},Vex.Flow.ornamentCodes.ornaments={mordent:{code:"v1e",shift_right:1,shift_up:0,shift_down:5,width:14},mordent_inverted:{code:"v45",shift_right:1,shift_up:0,shift_down:5,width:14},turn:{code:"v72",shift_right:1,shift_up:0,shift_down:5,width:20},turn_inverted:{code:"v33",shift_right:1,shift_up:0,shift_down:6,width:20},tr:{code:"v1f",shift_right:0,shift_up:5,shift_down:15,width:10},upprall:{code:"v60",shift_right:1,shift_up:-3,shift_down:6,width:20},downprall:{code:"vb4",shift_right:1,shift_up:-3,shift_down:6,width:20},prallup:{code:"v6d",shift_right:1,shift_up:-3,shift_down:6,width:20},pralldown:{code:"v2c",shift_right:1,shift_up:-3,shift_down:6,width:20},upmordent:{code:"v29",shift_right:1,shift_up:-3,shift_down:6,width:20},downmordent:{code:"v68",shift_right:1,shift_up:-3,shift_down:6,width:20},lineprall:{code:"v20",shift_right:1,shift_up:-3,shift_down:6,width:20},prallprall:{code:"v86",shift_right:1,shift_up:-3,shift_down:6,width:20}},Vex.Flow.keySignature=function(e){var t=Vex.Flow.keySignature.keySpecs[e];if(!t)throw new Vex.RERR("BadKeySignature","Bad key signature spec: '"+e+"'");if(!t.acc)return[];for(var n=Vex.Flow.keySignature.accidentalList(t.acc),i=[],o=0;o<t.num;++o){var a=n[o];i.push({type:t.acc,line:a})}return i},Vex.Flow.keySignature.keySpecs={C:{acc:null,num:0},Am:{acc:null,num:0},F:{acc:"b",num:1},Dm:{acc:"b",num:1},Bb:{acc:"b",num:2},Gm:{acc:"b",num:2},Eb:{acc:"b",num:3},Cm:{acc:"b",num:3},Ab:{acc:"b",num:4},Fm:{acc:"b",num:4},Db:{acc:"b",num:5},Bbm:{acc:"b",num:5},Gb:{acc:"b",num:6},Ebm:{acc:"b",num:6},Cb:{acc:"b",num:7},Abm:{acc:"b",num:7},G:{acc:"#",num:1},Em:{acc:"#",num:1},D:{acc:"#",num:2},Bm:{acc:"#",num:2},A:{acc:"#",num:3},"F#m":{acc:"#",num:3},E:{acc:"#",num:4},"C#m":{acc:"#",num:4},B:{acc:"#",num:5},"G#m":{acc:"#",num:5},"F#":{acc:"#",num:6},"D#m":{acc:"#",num:6},"C#":{acc:"#",num:7},"A#m":{acc:"#",num:7}},Vex.Flow.unicode={sharp:String.fromCharCode(parseInt("266F",16)),flat:String.fromCharCode(parseInt("266D",16)),natural:String.fromCharCode(parseInt("266E",16)),triangle:String.fromCharCode(parseInt("25B3",16)),"o-with-slash":String.fromCharCode(parseInt("00F8",16)),degrees:String.fromCharCode(parseInt("00B0",16)),circle:String.fromCharCode(parseInt("25CB",16))},Vex.Flow.keySignature.accidentalList=function(e){return"b"==e?[2,.5,2.5,1,3,1.5,3.5]:"#"==e?[0,1.5,-.5,1,2.5,.5,2]:void 0},Vex.Flow.parseNoteDurationString=function(e){if("string"!=typeof e)return null;var t=/(\d*\/?\d+|[a-z])(d*)([nrhms]|$)/,n=t.exec(e);if(!n)return null;var i=n[1],o=n[2].length,a=n[3];return 0===a.length&&(a="n"),{duration:i,dots:o,type:a}},Vex.Flow.parseNoteData=function(e){var t=e.duration,n=Vex.Flow.parseNoteDurationString(t);if(!n)return null;var i=Vex.Flow.durationToTicks(n.duration);if(null==i)return null;var o=e.type;if(o){if("n"!==o&&"r"!==o&&"h"!==o&&"m"!==o&&"s"!==o)return null}else o=n.type,o||(o="n");var a=0;if(a=e.dots?e.dots:n.dots,"number"!=typeof a)return null;for(var d=i,_=0;a>_;_++){if(1>=d)return null;d/=2,i+=d}return{duration:n.duration,type:o,dots:a,ticks:i}},Vex.Flow.durationToFraction=function(e){return(new Vex.Flow.Fraction).parse(sanitizeDuration(e))},Vex.Flow.durationToNumber=function(e){return Vex.Flow.durationToFraction(e).value()},Vex.Flow.durationToTicks=function(e){e=sanitizeDuration(e);var t=Vex.Flow.durationToTicks.durations[e];return void 0===t?null:t},Vex.Flow.durationToTicks.durations={"1/2":2*Vex.Flow.RESOLUTION,1:Vex.Flow.RESOLUTION/1,2:Vex.Flow.RESOLUTION/2,4:Vex.Flow.RESOLUTION/4,8:Vex.Flow.RESOLUTION/8,16:Vex.Flow.RESOLUTION/16,32:Vex.Flow.RESOLUTION/32,64:Vex.Flow.RESOLUTION/64,128:Vex.Flow.RESOLUTION/128,256:Vex.Flow.RESOLUTION/256},Vex.Flow.durationAliases={w:"1",h:"2",q:"4",b:"256"},Vex.Flow.durationToGlyph=function(e,t){var n=Vex.Flow.durationAliases[e];void 0!==n&&(e=n);var i=Vex.Flow.durationToGlyph.duration_codes[e];if(void 0===i)return null;t||(t="n");var o=i.type[t];return void 0===o?null:Vex.Merge(Vex.Merge({},i.common),o)},Vex.Flow.durationToGlyph.duration_codes={"1/2":{common:{head_width:22,stem:!1,stem_offset:0,flag:!1,stem_up_extension:-Vex.Flow.STEM_HEIGHT,stem_down_extension:-Vex.Flow.STEM_HEIGHT,gracenote_stem_up_extension:-Vex.Flow.STEM_HEIGHT,gracenote_stem_down_extension:-Vex.Flow.STEM_HEIGHT,tabnote_stem_up_extension:-Vex.Flow.STEM_HEIGHT,tabnote_stem_down_extension:-Vex.Flow.STEM_HEIGHT,dot_shiftY:0,line_above:0,line_below:0},type:{n:{code_head:"v53"},h:{code_head:"v59"},m:{code_head:"vf",stem_offset:0},r:{code_head:"v31",head_width:24,rest:!0,position:"B/5",dot_shiftY:.5},s:{head_width:15,position:"B/4"}}},1:{common:{head_width:16,stem:!1,stem_offset:0,flag:!1,stem_up_extension:-Vex.Flow.STEM_HEIGHT,stem_down_extension:-Vex.Flow.STEM_HEIGHT,gracenote_stem_up_extension:-Vex.Flow.STEM_HEIGHT,gracenote_stem_down_extension:-Vex.Flow.STEM_HEIGHT,tabnote_stem_up_extension:-Vex.Flow.STEM_HEIGHT,tabnote_stem_down_extension:-Vex.Flow.STEM_HEIGHT,dot_shiftY:0,line_above:0,line_below:0},type:{n:{code_head:"v1d"},h:{code_head:"v46"},m:{code_head:"v92",stem_offset:-3},r:{code_head:"v5c",head_width:12,rest:!0,position:"D/5",dot_shiftY:.5},s:{head_width:15,position:"B/4"}}},2:{common:{head_width:10,stem:!0,stem_offset:0,flag:!1,stem_up_extension:0,stem_down_extension:0,gracenote_stem_up_extension:-14,gracenote_stem_down_extension:-14,tabnote_stem_up_extension:0,tabnote_stem_down_extension:0,dot_shiftY:0,line_above:0,line_below:0},type:{n:{code_head:"v81"},h:{code_head:"v2d"},m:{code_head:"v95",stem_offset:-3},r:{code_head:"vc",head_width:12,stem:!1,rest:!0,position:"B/4",dot_shiftY:-.5},s:{head_width:15,position:"B/4"}}},4:{common:{head_width:10,stem:!0,stem_offset:0,flag:!1,stem_up_extension:0,stem_down_extension:0,gracenote_stem_up_extension:-14,gracenote_stem_down_extension:-14,tabnote_stem_up_extension:0,tabnote_stem_down_extension:0,dot_shiftY:0,line_above:0,line_below:0},type:{n:{code_head:"vb"},h:{code_head:"v22"},m:{code_head:"v3e",stem_offset:-3},r:{code_head:"v7c",head_width:8,stem:!1,rest:!0,position:"B/4",dot_shiftY:-.5,line_above:1.5,line_below:1.5},s:{head_width:15,position:"B/4"}}},8:{common:{head_width:10,stem:!0,stem_offset:0,flag:!0,beam_count:1,code_flag_upstem:"v54",code_flag_downstem:"v9a",stem_up_extension:0,stem_down_extension:0,gracenote_stem_up_extension:-14,gracenote_stem_down_extension:-14,tabnote_stem_up_extension:0,tabnote_stem_down_extension:0,dot_shiftY:0,line_above:0,line_below:0},type:{n:{code_head:"vb"},h:{code_head:"v22"},m:{code_head:"v3e"},r:{code_head:"va5",stem:!1,flag:!1,rest:!0,position:"B/4",dot_shiftY:-.5,line_above:1,line_below:1},s:{head_width:15,position:"B/4"}}},16:{common:{beam_count:2,head_width:10,stem:!0,stem_offset:0,flag:!0,code_flag_upstem:"v3f",code_flag_downstem:"v8f",stem_up_extension:4,stem_down_extension:0,gracenote_stem_up_extension:-14,gracenote_stem_down_extension:-14,tabnote_stem_up_extension:0,tabnote_stem_down_extension:0,dot_shiftY:0,line_above:0,line_below:0},type:{n:{code_head:"vb"},h:{code_head:"v22"},m:{code_head:"v3e"},r:{code_head:"v3c",head_width:13,stem:!1,flag:!1,rest:!0,position:"B/4",dot_shiftY:-.5,line_above:1,line_below:2},s:{head_width:15,position:"B/4"}}},32:{common:{beam_count:3,head_width:10,stem:!0,stem_offset:0,flag:!0,code_flag_upstem:"v47",code_flag_downstem:"v2a",stem_up_extension:13,stem_down_extension:9,gracenote_stem_up_extension:-12,gracenote_stem_down_extension:-12,tabnote_stem_up_extension:9,tabnote_stem_down_extension:5,dot_shiftY:0,line_above:0,line_below:0},type:{n:{code_head:"vb"},h:{code_head:"v22"},m:{code_head:"v3e"},r:{code_head:"v55",head_width:16,stem:!1,flag:!1,rest:!0,position:"B/4",dot_shiftY:-1.5,line_above:2,line_below:2},s:{head_width:15,position:"B/4"}}},64:{common:{beam_count:4,head_width:10,stem:!0,stem_offset:0,flag:!0,code_flag_upstem:"va9",code_flag_downstem:"v58",stem_up_extension:17,stem_down_extension:13,gracenote_stem_up_extension:-10,gracenote_stem_down_extension:-10,tabnote_stem_up_extension:13,tabnote_stem_down_extension:9,dot_shiftY:0,line_above:0,line_below:0},type:{n:{code_head:"vb"},h:{code_head:"v22"},m:{code_head:"v3e"},r:{code_head:"v38",head_width:18,stem:!1,flag:!1,rest:!0,position:"B/4",dot_shiftY:-1.5,line_above:2,line_below:3},s:{head_width:15,position:"B/4"}}},128:{common:{beam_count:5,head_width:10,stem:!0,stem_offset:0,flag:!0,code_flag_upstem:"v9b",code_flag_downstem:"v30",stem_up_extension:26,stem_down_extension:22,gracenote_stem_up_extension:-8,gracenote_stem_down_extension:-8,tabnote_stem_up_extension:22,tabnote_stem_down_extension:18,dot_shiftY:0,line_above:0,line_below:0},type:{n:{code_head:"vb"},h:{code_head:"v22"},m:{code_head:"v3e"},r:{code_head:"vaa",head_width:20,stem:!1,flag:!1,rest:!0,position:"B/4",dot_shiftY:1.5,line_above:3,line_below:3},s:{head_width:15,position:"B/4"}}}},Vex.Flow.TIME4_4={num_beats:4,beat_value:4,resolution:Vex.Flow.RESOLUTION};Vex.Flow.Font={glyphs:{v0:{x_min:0,x_max:514.5,ha:525,o:"m 236 648 b 246 648 238 648 242 648 b 288 646 261 648 283 648 b 472 513 364 634 428 587 b 514 347 502 464 514 413 b 462 163 514 272 499 217 b 257 44 409 83 333 44 b 50 163 181 44 103 83 b 0 347 14 217 0 272 b 40 513 0 413 12 464 b 236 648 87 591 155 638 m 277 614 b 253 616 273 616 261 616 b 242 616 247 616 243 616 b 170 499 193 609 181 589 b 159 348 163 446 159 398 b 166 222 159 308 161 266 b 201 91 174 138 183 106 b 257 76 215 81 235 76 b 311 91 277 76 299 81 b 347 222 330 106 338 138 b 353 348 352 266 353 308 b 344 499 353 398 351 446 b 277 614 333 587 322 606 m 257 -1 l 258 -1 l 255 -1 l 257 -1 m 257 673 l 258 673 l 255 673 l 257 673 "},v1:{x_min:-1.359375,x_max:344.359375,ha:351,o:"m 126 637 l 129 638 l 198 638 l 266 638 l 269 635 b 274 631 272 634 273 632 l 277 627 l 277 395 b 279 156 277 230 277 161 b 329 88 281 123 295 106 b 344 69 341 81 344 79 b 337 55 344 62 343 59 l 333 54 l 197 54 l 61 54 l 58 55 b 50 69 53 59 50 62 b 65 88 50 79 53 81 b 80 97 72 91 74 93 b 117 156 103 113 112 129 b 117 345 117 161 117 222 l 117 528 l 100 503 l 38 406 b 14 383 24 384 23 383 b -1 398 5 383 -1 390 b 4 415 -1 403 1 409 b 16 437 5 416 10 426 l 72 539 l 100 596 b 121 632 119 631 119 631 b 126 637 122 634 125 635 m 171 -1 l 172 -1 l 170 -1 l 171 -1 m 171 673 l 172 673 l 170 673 l 171 673 "},v2:{x_min:-1.359375,x_max:458.6875,ha:468,o:"m 197 648 b 216 648 201 648 208 648 b 258 646 232 648 253 648 b 419 546 333 637 393 599 b 432 489 428 528 432 509 b 356 342 432 440 405 384 b 235 278 322 313 288 295 b 69 170 166 256 107 217 b 69 169 69 170 69 169 b 69 169 69 169 69 169 b 74 173 69 169 72 170 b 209 222 112 204 163 222 b 310 195 247 222 274 215 b 371 179 332 184 352 179 b 396 181 379 179 387 179 b 428 202 409 184 423 194 b 442 212 431 209 436 212 b 458 197 450 212 458 206 b 441 148 458 190 449 165 b 299 44 409 84 353 44 b 288 45 295 44 292 44 b 250 61 274 45 268 49 b 122 99 212 86 164 99 b 73 91 104 99 88 97 b 28 63 53 84 34 72 b 14 54 25 56 20 54 b 1 62 9 54 4 56 l -1 65 l -1 79 b 0 99 -1 91 0 95 b 2 113 1 102 2 108 b 164 309 20 197 81 272 b 285 470 232 341 277 398 b 287 487 287 476 287 481 b 171 595 287 551 239 595 b 155 595 166 595 160 595 b 142 592 145 594 142 594 b 145 589 142 592 142 591 b 179 527 168 576 179 551 b 132 455 179 496 163 467 b 104 451 122 452 112 451 b 27 530 62 451 27 487 b 29 555 27 538 27 546 b 197 648 44 601 115 639 m 228 -1 l 230 -1 l 227 -1 l 228 -1 m 228 673 l 230 673 l 227 673 l 228 673 "},v3:{x_min:-1.359375,x_max:409.6875,ha:418,o:"m 174 648 b 191 648 176 648 183 648 b 225 648 204 648 220 648 b 402 523 317 638 389 588 b 404 503 404 517 404 510 b 402 484 404 495 404 488 b 264 373 389 437 334 394 b 257 370 259 371 257 371 b 257 370 257 370 257 370 b 264 369 258 370 261 369 b 409 202 359 334 409 267 b 318 72 409 152 381 104 b 200 43 281 52 240 43 b 23 113 134 43 69 68 b 0 169 6 129 0 149 b 77 249 0 210 29 249 l 77 249 b 152 174 125 249 152 212 b 103 102 152 145 137 116 b 103 102 103 102 103 102 b 147 94 103 101 132 95 b 153 94 149 94 151 94 b 265 206 219 94 265 141 b 264 226 265 213 265 219 b 147 355 253 299 204 353 b 126 371 133 356 126 362 b 147 388 126 383 132 388 b 254 474 196 391 238 424 b 259 502 258 484 259 494 b 182 592 259 544 228 582 b 156 595 175 595 166 595 b 115 592 142 595 129 594 l 111 591 l 115 588 b 152 524 141 574 152 549 b 92 449 152 491 130 458 b 76 448 87 448 81 448 b -1 530 32 448 -1 488 b 20 581 -1 548 5 566 b 174 648 55 619 108 641 m 204 -1 l 205 -1 l 202 -1 l 204 -1 m 204 673 l 205 673 l 202 673 l 204 673 "},v4:{x_min:0,x_max:468.21875,ha:478,o:"m 174 637 b 232 638 175 638 189 638 b 277 638 245 638 259 638 l 378 638 l 381 635 b 389 623 386 632 389 627 b 382 609 389 617 386 613 b 366 589 381 606 372 598 l 313 528 l 245 451 l 209 410 l 155 348 l 84 267 b 59 240 72 252 59 240 b 59 240 59 240 59 240 b 151 238 59 238 68 238 l 242 238 l 242 303 b 243 371 242 369 242 370 b 289 426 245 374 254 385 l 303 441 l 317 456 l 338 483 l 360 506 l 371 520 b 386 527 375 526 381 527 b 400 519 392 527 397 524 b 401 440 401 516 401 514 b 401 377 401 423 401 402 l 401 238 l 426 238 b 453 237 449 238 450 238 b 465 217 461 234 465 226 b 460 202 465 212 464 206 b 426 197 454 197 453 197 l 401 197 l 401 180 b 451 88 402 129 412 109 b 468 69 465 81 468 79 b 461 55 468 62 466 59 l 458 54 l 321 54 l 185 54 l 182 55 b 175 69 176 59 175 62 b 191 88 175 79 176 81 b 240 180 230 109 240 129 l 240 197 l 125 197 b 73 195 104 195 87 195 b 8 197 10 195 9 197 b 0 212 2 199 0 205 b 0 212 0 212 0 212 b 20 242 0 219 0 219 b 163 610 104 344 163 492 b 174 637 163 628 166 634 m 234 -1 l 235 -1 l 232 -1 l 234 -1 m 234 673 l 235 673 l 232 673 l 234 673 "},v5:{x_min:0,x_max:409.6875,ha:418,o:"m 47 637 b 53 638 49 638 50 638 b 69 634 55 638 61 637 b 210 610 114 619 161 610 b 363 634 259 610 311 619 b 382 638 372 637 378 638 b 392 634 386 638 389 637 b 397 623 396 630 397 627 b 393 610 397 620 396 616 b 298 505 368 552 338 520 b 212 494 277 498 246 494 b 65 517 163 494 106 502 b 61 517 62 517 61 517 b 61 517 61 517 61 517 b 51 408 61 517 51 412 b 51 408 51 408 51 408 b 51 408 51 408 51 408 b 61 412 53 408 55 409 b 125 434 80 421 103 430 b 185 441 145 440 166 441 b 409 244 310 441 409 353 b 401 191 409 227 406 209 b 197 43 375 105 287 43 b 159 47 183 43 171 44 b 23 123 112 56 61 86 b 0 180 6 140 0 159 b 76 260 0 220 31 260 b 92 259 81 260 87 259 b 152 183 132 251 152 216 b 100 112 152 152 134 122 b 95 111 98 112 95 111 b 95 111 95 111 95 111 b 129 98 95 109 119 101 b 148 97 136 97 141 97 b 264 235 206 97 261 158 b 265 248 265 240 265 244 b 210 398 265 312 243 373 b 179 408 201 406 194 408 b 174 408 178 408 176 408 b 53 369 130 408 88 394 b 34 359 39 359 38 359 b 17 374 24 359 17 365 b 39 628 17 384 38 625 b 47 637 40 631 43 635 m 204 -1 l 205 -1 l 202 -1 l 204 -1 m 204 673 l 205 673 l 202 673 l 204 673 "},v6:{x_min:0,x_max:475.03125,ha:485,o:"m 255 648 b 274 648 259 648 266 648 b 314 646 288 648 307 648 b 450 555 374 637 438 594 b 454 530 453 546 454 538 b 375 451 454 485 416 451 b 328 467 359 451 343 455 b 300 526 310 483 300 503 b 352 598 300 557 319 589 b 356 599 355 598 356 599 b 352 602 356 599 355 601 b 288 616 330 612 308 616 b 210 584 257 616 230 605 b 164 433 189 559 174 508 b 160 374 163 415 160 381 b 160 374 160 374 160 374 b 160 374 160 374 160 374 b 168 377 160 374 164 376 b 258 395 200 390 228 395 b 366 367 294 395 328 387 b 475 223 436 333 475 283 b 472 197 475 215 473 206 b 349 65 462 141 419 95 b 259 43 317 51 288 43 b 167 69 230 43 200 52 b 4 290 80 113 20 195 b 0 349 1 309 0 328 b 20 467 0 391 6 433 b 255 648 58 563 155 637 m 269 363 b 257 363 265 363 261 363 b 210 345 236 363 220 356 b 186 226 196 324 186 272 b 187 198 186 216 186 206 b 213 95 191 151 202 112 b 257 76 221 83 238 76 b 270 77 261 76 266 76 b 321 156 299 81 310 99 b 329 229 326 183 329 206 b 321 301 329 252 326 274 b 269 363 311 342 298 359 m 236 -1 l 238 -1 l 235 -1 l 236 -1 m 236 673 l 238 673 l 235 673 l 236 673 "},v7:{x_min:0,x_max:442.359375,ha:451,o:"m 147 648 b 166 649 153 649 160 649 b 313 598 217 649 273 630 b 340 587 323 588 328 587 l 341 587 b 412 628 367 587 390 601 b 427 638 416 635 421 638 b 439 632 431 638 435 637 b 442 623 441 630 442 628 b 430 569 442 616 439 603 b 352 369 408 492 377 410 b 300 259 325 324 313 298 b 273 84 283 205 273 140 b 265 55 273 65 272 59 l 261 54 l 181 54 l 99 54 l 96 55 b 91 61 95 56 92 59 l 89 63 l 89 77 b 147 263 89 133 111 202 b 261 401 176 313 212 355 b 378 541 315 449 349 489 l 382 548 l 375 544 b 240 495 333 512 285 495 b 129 535 198 495 160 509 b 84 560 108 552 95 560 b 76 559 81 560 78 560 b 31 487 59 555 43 530 b 14 470 27 473 24 470 b 1 477 8 470 4 471 l 0 480 l 0 553 l 0 627 l 1 630 b 16 638 4 635 9 638 b 23 635 17 638 20 637 b 49 626 36 626 39 626 b 96 638 59 626 80 630 b 104 639 99 638 102 639 b 117 644 107 641 112 642 b 147 648 125 645 137 648 m 220 -1 l 221 -1 l 219 -1 l 220 -1 m 220 673 l 221 673 l 219 673 l 220 673 "},v8:{x_min:0,x_max:488.640625,ha:499,o:"m 217 648 b 245 649 225 648 235 649 b 453 516 343 649 430 595 b 458 478 455 503 458 491 b 412 370 458 440 441 398 b 411 369 412 369 411 369 b 415 365 411 367 412 367 b 488 231 462 331 488 281 b 472 165 488 208 483 186 b 243 43 434 86 338 43 b 63 104 178 43 112 62 b 0 233 20 140 0 186 b 73 365 0 283 24 331 l 77 369 l 72 374 b 29 476 42 406 29 441 b 217 648 29 557 103 635 m 258 605 b 242 606 253 605 247 606 b 157 552 198 606 157 580 b 160 541 157 548 159 544 b 319 413 176 503 242 452 l 337 403 l 338 406 b 359 476 352 428 359 452 b 258 605 359 537 318 595 m 138 326 b 130 330 134 328 130 330 b 130 330 130 330 130 330 b 107 305 127 330 112 313 b 84 231 91 281 84 256 b 243 86 84 156 151 86 b 249 87 245 86 246 87 b 347 156 303 88 347 120 b 344 172 347 162 345 167 b 156 319 325 227 257 281 b 138 326 151 322 144 324 m 243 -1 l 245 -1 l 242 -1 l 243 -1 m 243 673 l 245 673 l 242 673 l 243 673 "},v9:{x_min:0,x_max:475.03125,ha:485,o:"m 191 646 b 212 649 198 648 205 649 b 255 644 227 649 243 646 b 458 448 348 616 428 539 b 475 342 469 415 475 378 b 460 244 475 308 469 274 b 193 44 421 124 303 44 b 91 69 157 44 122 51 b 19 161 43 97 19 126 b 21 181 19 167 20 174 b 98 241 32 220 65 241 b 170 186 129 241 160 223 b 172 166 171 179 172 173 b 121 94 172 134 152 102 b 117 93 118 94 117 93 b 121 90 117 93 118 91 b 185 76 142 80 164 76 b 270 119 220 76 251 91 b 308 259 287 145 300 194 b 313 317 310 277 313 310 b 313 317 313 317 313 317 b 313 317 313 317 313 317 b 304 315 313 317 308 316 b 216 295 273 302 245 295 b 145 308 193 295 170 299 b 19 398 88 327 42 360 b 0 469 5 420 0 444 b 24 551 0 496 8 526 b 191 646 54 596 125 637 m 227 614 b 215 616 224 616 220 616 b 202 614 210 616 206 616 b 152 535 174 610 163 592 b 144 463 147 509 144 485 b 152 391 144 440 147 417 b 216 328 163 344 179 328 b 280 391 253 328 269 344 b 288 463 285 417 288 440 b 280 535 288 485 285 509 b 227 614 269 594 258 610 m 236 -1 l 238 -1 l 235 -1 l 236 -1 m 236 673 l 238 673 l 235 673 l 236 673 "},va:{x_min:-149.71875,x_max:148.359375,ha:151,o:"m -8 -1 b -1 0 -5 -1 -4 0 b 16 -11 5 0 13 -4 b 83 -186 17 -12 47 -90 l 148 -358 l 148 -363 b 127 -385 148 -376 138 -385 b 112 -378 122 -385 118 -383 b 54 -226 110 -374 114 -385 b 0 -81 24 -147 0 -81 b -55 -226 -1 -81 -25 -147 b -114 -378 -115 -385 -111 -374 b -129 -385 -119 -383 -123 -385 b -149 -363 -140 -385 -149 -376 l -149 -358 l -84 -186 b -19 -11 -49 -90 -19 -12 b -8 -1 -17 -8 -12 -4 "},vb:{x_min:0,x_max:428.75,ha:438,o:"m 262 186 b 273 186 266 186 272 186 b 274 186 273 186 274 186 b 285 186 274 186 280 186 b 428 48 375 181 428 122 b 386 -68 428 12 416 -29 b 155 -187 329 -145 236 -187 b 12 -111 92 -187 38 -162 b 0 -51 4 -91 0 -72 b 262 186 0 58 122 179 "},vc:{x_min:0,x_max:447.8125,ha:457,o:"m 0 86 l 0 173 l 223 173 l 447 173 l 447 86 l 447 0 l 223 0 l 0 0 l 0 86 "},vf:{x_min:0,x_max:370.21875,ha:378,o:"m 0 0 l 0 277 l 61 277 l 122 277 l 122 0 l 122 -278 l 61 -278 l 0 -278 l 0 0 m 246 -1 l 246 277 l 308 277 l 370 277 l 370 -1 l 370 -278 l 308 -278 l 246 -278 l 246 -1 "},v10:{x_min:0,x_max:559.421875,ha:571,o:"m 5 127 b 14 127 6 127 9 127 b 51 126 25 127 43 127 b 175 98 93 122 138 112 l 186 94 b 279 51 210 86 255 65 b 285 47 280 51 283 48 b 319 27 291 44 311 31 l 326 22 b 359 0 332 19 352 4 l 367 -6 b 371 -9 368 -6 370 -8 l 379 -15 b 387 -22 383 -18 386 -20 l 398 -30 l 411 -40 l 417 -47 l 427 -55 l 434 -61 b 441 -66 436 -62 439 -65 l 446 -72 l 453 -77 l 462 -87 b 558 -188 490 -113 549 -176 b 559 -195 559 -191 559 -194 b 548 -205 559 -201 555 -205 b 541 -204 547 -205 544 -205 b 534 -198 539 -201 536 -199 l 525 -191 b 481 -162 518 -187 490 -167 b 472 -155 477 -159 472 -156 b 468 -152 470 -155 469 -154 b 461 -149 466 -152 464 -151 b 428 -130 454 -145 441 -137 b 371 -99 413 -122 372 -99 b 363 -95 371 -99 367 -98 b 353 -91 357 -94 353 -91 b 348 -90 353 -91 352 -91 b 332 -81 343 -87 341 -86 b 27 -12 230 -37 127 -13 b 0 -5 4 -11 2 -11 b 0 58 0 -2 0 27 b 0 122 0 88 0 120 b 5 127 1 124 4 126 "},v11:{x_min:-155.171875,x_max:153.8125,ha:157,o:"m -137 353 b -130 353 -136 353 -133 353 b -112 349 -125 353 -119 352 b -100 342 -110 347 -104 344 b 0 317 -69 326 -35 317 b 111 349 38 317 76 328 b 129 353 117 352 123 353 b 153 327 142 353 153 344 b 144 302 153 320 153 317 b 27 6 93 226 50 113 b 21 -13 24 -11 24 -11 b 0 -26 17 -22 8 -26 b -24 -12 -9 -26 -19 -22 b -28 5 -24 -9 -27 -2 b -145 302 -53 117 -95 224 b -155 327 -155 317 -155 320 b -137 353 -155 340 -148 349 "},v18:{x_min:0,x_max:323.9375,ha:331,o:"m 217 535 b 225 537 220 537 221 537 b 245 524 235 537 242 533 l 246 521 l 247 390 l 247 258 l 273 265 b 306 270 288 269 299 270 b 322 259 315 270 319 267 b 323 208 323 256 323 233 b 322 158 323 184 323 159 b 288 140 318 148 315 147 b 247 130 254 131 247 130 b 247 65 247 130 247 104 b 247 20 247 51 247 36 l 247 -88 l 273 -81 b 306 -76 289 -77 299 -76 b 318 -81 311 -76 315 -77 b 323 -123 323 -87 323 -86 l 323 -138 l 323 -154 b 318 -195 323 -191 323 -190 b 269 -210 314 -199 315 -199 b 249 -216 259 -213 250 -216 l 247 -216 l 247 -349 l 246 -483 l 245 -487 b 225 -499 242 -495 234 -499 b 206 -487 219 -499 210 -495 l 205 -483 l 205 -355 l 205 -227 l 204 -227 l 181 -233 l 138 -244 b 117 -249 127 -247 117 -249 b 115 -385 115 -249 115 -256 l 115 -523 l 114 -526 b 95 -538 110 -534 102 -538 b 74 -526 87 -538 78 -534 l 73 -523 l 73 -391 b 72 -260 73 -269 73 -260 b 72 -260 72 -260 72 -260 b 19 -273 61 -263 23 -273 b 0 -260 10 -273 4 -267 b 0 -209 0 -256 0 -256 l 0 -162 l 1 -158 b 61 -134 5 -148 5 -148 l 73 -131 l 73 -22 b 72 86 73 79 73 86 b 72 86 72 86 72 86 b 19 74 61 83 23 74 b 0 86 10 74 4 79 b 0 137 0 90 0 90 l 0 184 l 1 188 b 61 212 5 198 5 198 l 73 215 l 73 348 l 73 481 l 74 485 b 95 498 78 492 87 498 b 103 495 98 498 100 496 b 114 485 107 494 111 489 l 115 481 l 115 353 l 115 226 l 121 226 b 159 235 123 227 141 231 l 198 247 l 205 248 l 205 384 l 205 521 l 206 524 b 217 535 209 528 212 533 m 205 9 b 205 119 205 70 205 119 l 205 119 b 182 113 204 119 194 116 l 138 102 b 117 97 127 99 117 97 b 115 -12 115 97 115 91 l 115 -122 l 121 -120 b 159 -111 123 -119 141 -115 l 198 -101 l 205 -98 l 205 9 "},v1b:{x_min:0,x_max:559.421875,ha:571,o:"m 544 204 b 548 204 545 204 547 204 b 559 194 555 204 559 199 b 559 190 559 192 559 191 b 530 156 559 188 556 184 b 462 86 510 134 481 104 b 453 76 458 81 454 77 l 446 70 l 441 65 b 434 59 439 63 436 61 l 427 54 b 409 37 426 51 416 44 b 392 23 398 29 394 26 b 387 19 389 22 387 20 b 379 13 386 19 383 16 l 371 8 l 367 5 l 359 -1 l 337 -16 b 285 -48 319 -29 298 -41 l 279 -52 b 186 -95 255 -66 210 -87 l 175 -99 b 23 -129 127 -117 68 -129 b 17 -129 20 -129 19 -129 b 1 -123 2 -129 2 -129 b 0 -49 0 -122 0 -83 b 0 4 0 -22 0 1 b 27 11 2 9 4 9 b 185 31 78 12 145 20 b 198 34 186 31 193 33 b 314 73 234 44 277 58 b 349 88 328 79 340 84 b 353 90 352 90 353 90 b 363 94 353 90 357 93 b 371 98 367 97 371 98 b 428 129 372 98 413 120 b 461 148 441 136 454 144 b 468 151 464 149 466 151 b 472 154 469 152 470 154 b 481 161 473 155 477 158 b 525 190 490 166 518 186 l 534 197 b 540 201 536 198 539 199 b 544 204 541 202 544 204 "},v1d:{x_min:0,x_max:619.3125,ha:632,o:"m 274 184 b 307 186 285 186 296 186 b 616 22 465 186 597 116 b 619 -1 617 13 619 5 b 308 -187 619 -104 483 -187 b 0 -1 133 -187 0 -102 b 5 36 0 11 1 23 b 274 184 29 115 141 176 m 289 161 b 272 162 284 162 277 162 b 171 41 209 162 171 108 b 205 -73 171 5 182 -34 b 345 -163 243 -133 298 -163 b 436 -98 385 -163 420 -142 b 446 -43 443 -80 446 -62 b 289 161 446 47 377 147 "},v1e:{x_min:-402.890625,x_max:401.53125,ha:410,o:"m -219 173 b -213 174 -217 174 -215 174 b -202 173 -209 174 -205 173 b -114 86 -200 172 -179 151 b -28 0 -66 37 -28 0 b 40 84 -28 0 2 37 b 117 174 111 173 110 172 b 122 174 118 174 119 174 b 132 173 125 174 129 173 b 295 11 134 172 171 134 l 307 -1 l 336 34 b 374 76 366 72 368 74 b 381 77 375 77 378 77 b 401 56 392 77 401 68 b 400 48 401 54 401 51 b 223 -172 397 41 230 -166 b 210 -176 220 -174 215 -176 b 201 -174 206 -176 204 -176 b 112 -87 198 -173 178 -152 b 27 0 65 -38 27 0 b -42 -86 27 0 -4 -38 b -118 -174 -112 -174 -111 -173 b -123 -176 -119 -176 -121 -176 b -133 -174 -126 -176 -130 -174 b -296 -12 -136 -173 -172 -137 l -308 0 l -337 -34 b -375 -77 -367 -73 -370 -76 b -382 -79 -377 -79 -379 -79 b -402 -58 -393 -79 -402 -69 b -401 -49 -402 -55 -402 -52 b -224 172 -398 -43 -228 167 b -219 173 -223 172 -220 173 "},v1f:{x_min:-340.28125,x_max:338.921875,ha:346,o:"m -32 520 b -29 521 -31 520 -31 521 b -23 519 -27 521 -24 520 b -20 513 -21 517 -20 516 b -21 506 -20 512 -20 509 b -31 474 -23 502 -27 488 l -53 402 l -66 352 l -68 349 l -57 349 b -32 351 -51 349 -40 351 b 123 370 19 352 74 359 b 137 371 127 370 133 371 b 170 356 152 371 164 366 b 171 355 170 355 170 355 b 216 366 174 355 183 358 b 280 378 268 377 266 377 b 287 378 283 378 284 378 b 332 349 307 378 322 369 b 338 319 336 341 338 330 b 332 301 338 310 336 302 b 242 280 329 299 246 280 b 242 280 242 280 242 280 b 235 288 236 280 235 283 b 235 292 235 290 235 291 b 236 302 236 297 236 299 b 220 337 236 316 230 330 l 216 340 l 210 335 b 159 276 189 322 172 301 b 118 149 152 265 156 274 b 81 34 84 36 85 36 b -8 13 78 33 -4 13 b -8 13 -8 13 -8 13 b -14 20 -12 15 -14 15 b -8 44 -14 24 -12 31 b -2 66 -5 55 -2 65 b -2 66 -2 66 -2 66 l -2 66 b -43 41 -2 66 -21 55 b -114 4 -98 8 -98 8 b -144 0 -123 0 -134 0 b -242 99 -197 0 -242 43 b -242 109 -242 102 -242 105 b -212 219 -240 122 -242 116 b -185 312 -197 270 -185 312 l -185 312 b -189 312 -185 312 -186 312 b -259 312 -200 312 -227 312 b -321 310 -291 312 -310 310 b -334 312 -330 310 -334 312 b -340 319 -338 313 -340 316 b -336 326 -340 322 -338 324 b -291 337 -334 326 -314 331 l -247 347 l -210 348 b -172 348 -190 348 -172 348 b -168 363 -172 348 -171 355 b -145 442 -151 424 -145 441 b -133 452 -144 444 -140 446 l -77 489 b -32 520 -53 506 -32 520 m 57 334 b 53 335 55 335 54 335 b 44 334 50 335 49 335 b -70 316 8 326 -28 320 b -78 309 -78 316 -78 316 b -108 202 -80 305 -88 274 b -141 81 -136 112 -141 93 b -140 74 -141 79 -141 77 b -117 49 -137 59 -127 49 b -107 52 -114 49 -110 51 b 16 127 -106 54 14 126 b 42 217 16 127 42 215 b 49 241 42 222 44 229 b 73 320 53 251 73 317 b 57 334 73 327 65 333 "},v20:{x_min:-571.671875,x_max:570.3125,ha:582,o:"m -559 351 b -551 352 -556 352 -553 352 b -530 338 -543 352 -533 348 b -529 169 -530 337 -529 291 l -529 1 l -507 27 l -441 112 b -382 174 -394 169 -390 174 b -378 174 -381 174 -379 174 b -281 86 -370 174 -375 179 b -196 0 -234 37 -196 0 b -126 84 -196 0 -164 37 b -50 174 -55 173 -57 172 b -44 174 -49 174 -47 174 b -35 173 -42 174 -38 173 b 53 86 -32 172 -12 151 b 138 0 100 37 138 0 b 208 84 140 0 170 37 b 284 174 279 173 279 172 b 289 174 285 174 288 174 b 300 173 294 174 298 173 b 462 11 303 172 340 134 l 475 -1 l 503 34 b 541 76 534 72 536 74 b 548 77 544 77 545 77 b 570 56 560 77 570 68 b 567 48 570 54 568 51 b 392 -172 564 41 397 -166 b 378 -176 387 -174 382 -176 b 368 -174 375 -176 371 -176 b 280 -87 367 -173 347 -152 b 194 0 234 -38 194 0 b 126 -86 194 0 163 -38 b 49 -174 54 -174 55 -173 b 44 -176 47 -176 46 -176 b 34 -174 40 -176 36 -174 b -54 -87 31 -173 10 -152 b -140 0 -102 -38 -140 0 b -209 -86 -140 0 -171 -38 b -285 -174 -280 -174 -279 -173 b -291 -176 -287 -176 -288 -176 b -300 -174 -294 -176 -298 -174 b -464 -11 -303 -173 -374 -102 l -476 0 l -506 -37 b -539 -76 -528 -65 -537 -74 b -551 -80 -543 -79 -547 -80 b -570 -68 -558 -80 -566 -76 l -571 -65 l -571 136 b -570 340 -571 331 -571 337 b -559 351 -568 344 -564 348 "},v22:{x_min:0,x_max:432.828125,ha:442,o:"m 209 186 b 213 187 210 187 212 187 b 216 187 215 187 216 187 b 224 174 216 186 220 180 b 420 -1 269 105 338 43 b 432 -12 431 -8 432 -9 b 421 -23 432 -15 432 -16 b 228 -180 345 -70 264 -137 b 219 -188 221 -188 221 -188 l 219 -188 b 208 -177 215 -188 215 -188 b 10 1 163 -106 93 -44 b 0 11 0 6 0 8 b 10 22 0 13 0 15 b 202 179 87 69 167 136 b 209 186 206 183 209 186 "},v23:{x_min:0,x_max:133.390625,ha:136,o:"m 54 66 b 65 68 58 68 61 68 b 122 37 88 68 110 56 b 133 -1 130 26 133 12 b 104 -58 133 -23 123 -44 b 66 -69 92 -65 78 -69 b 10 -38 44 -69 23 -58 b 0 -1 2 -27 0 -13 b 54 66 0 30 20 61 "},v25:{x_min:0,x_max:318.5,ha:325,o:"m 20 376 b 167 377 23 377 96 377 b 296 376 231 377 294 377 b 318 347 311 371 318 359 b 296 316 318 333 311 320 b 159 315 294 315 227 315 b 21 316 91 315 24 315 b 0 345 6 320 0 333 b 20 376 0 359 6 371 "},v26:{x_min:-21.78125,x_max:483.1875,ha:493,o:"m -8 631 b -1 632 -6 632 -4 632 b 19 620 8 632 16 628 b 20 383 20 616 20 616 l 20 148 l 21 151 b 140 199 59 183 102 199 b 206 179 164 199 187 192 l 210 176 l 210 396 l 210 617 l 212 621 b 231 632 216 628 223 632 b 250 620 239 632 247 628 b 251 383 251 616 251 616 l 251 148 l 254 151 b 370 199 291 183 332 199 b 415 191 385 199 400 197 b 483 84 458 176 483 134 b 461 0 483 58 476 29 b 332 -142 439 -40 411 -72 l 255 -215 b 231 -229 240 -229 239 -229 b 216 -223 224 -229 220 -227 b 210 -158 210 -217 210 -223 b 210 -120 210 -148 210 -136 l 210 -29 l 205 -34 b 100 -142 182 -65 159 -88 l 23 -215 b -1 -229 9 -229 6 -229 b -20 -216 -9 -229 -17 -224 l -21 -212 l -21 201 l -21 616 l -20 620 b -8 631 -17 624 -13 630 m 110 131 b 96 133 106 133 100 133 b 89 133 93 133 91 133 b 24 87 63 129 40 113 l 20 80 l 20 -37 l 20 -156 l 23 -152 b 144 81 96 -72 144 20 l 144 83 b 110 131 144 113 134 126 m 341 131 b 328 133 337 133 332 133 b 322 133 326 133 323 133 b 257 87 296 129 273 113 l 251 80 l 251 -37 l 251 -156 l 255 -152 b 375 81 328 -72 375 20 l 375 83 b 341 131 375 113 367 126 "},v27:{x_min:0,x_max:432.828125,ha:442,o:"m 208 184 b 213 187 209 186 212 187 b 224 176 217 187 221 183 b 245 147 225 172 235 159 b 419 -1 288 90 347 38 b 431 -8 424 -4 431 -8 b 432 -12 432 -9 432 -11 b 430 -18 432 -13 432 -16 b 364 -61 424 -20 383 -47 b 225 -183 307 -102 250 -152 b 223 -187 224 -184 223 -187 b 220 -188 221 -188 220 -188 b 208 -176 216 -188 210 -184 b 187 -148 205 -173 197 -159 b 12 0 144 -90 84 -38 b 0 11 4 5 0 8 b 16 24 0 13 4 18 b 183 158 83 69 141 115 b 208 184 194 169 198 173 m 183 105 b 176 113 181 109 176 113 b 172 109 176 113 175 112 b 92 45 149 90 117 62 l 88 41 l 102 31 b 247 -105 160 -6 210 -55 l 254 -115 l 257 -112 l 269 -102 b 340 -45 287 -87 319 -61 l 344 -43 l 330 -33 b 183 105 272 6 221 54 "},v28:{x_min:-73.5,x_max:72.140625,ha:74,o:"m -72 252 l -73 254 l 0 254 l 72 254 l 70 252 b 0 -1 70 248 0 -1 b -72 252 -1 -1 -72 248 "},v29:{x_min:-590.71875,x_max:589.359375,ha:601,o:"m 175 273 b 182 274 178 273 181 274 b 202 262 190 274 198 269 b 204 158 204 259 204 259 l 204 56 l 250 112 b 303 174 296 172 298 172 b 308 174 304 174 307 174 b 318 173 313 174 317 173 b 481 11 322 172 357 134 l 494 -1 l 522 34 b 560 76 553 72 555 74 b 567 77 563 77 564 77 b 589 56 579 77 589 68 b 586 48 589 54 588 51 b 411 -172 583 41 416 -166 b 397 -176 406 -174 401 -176 b 387 -174 393 -176 390 -176 b 299 -87 386 -173 366 -152 b 213 0 253 -38 213 0 b 208 -6 213 0 210 -2 l 204 -12 l 204 -147 b 204 -210 204 -173 204 -194 b 198 -292 204 -297 204 -287 b 183 -299 194 -297 189 -299 b 164 -287 175 -299 167 -295 b 163 -174 163 -284 163 -284 l 161 -63 l 119 -117 b 65 -176 76 -170 73 -176 b 61 -176 63 -176 62 -176 b -35 -87 51 -174 57 -180 b -121 0 -83 -38 -121 0 b -190 -86 -122 0 -152 -38 b -266 -174 -261 -174 -259 -173 b -272 -176 -268 -176 -270 -176 b -281 -174 -276 -176 -280 -174 b -371 -86 -284 -173 -304 -152 b -457 0 -417 -38 -457 0 l -457 0 b -477 -26 -457 0 -470 -16 b -548 -227 -524 -88 -548 -161 b -536 -303 -548 -254 -544 -280 b -533 -317 -534 -309 -533 -313 b -553 -338 -533 -330 -541 -338 b -577 -315 -566 -338 -571 -333 b -590 -227 -586 -287 -590 -258 b -518 -9 -590 -154 -564 -77 b -465 56 -509 2 -504 8 l -402 134 b -363 174 -374 170 -371 174 b -359 174 -362 174 -360 174 b -262 86 -351 174 -356 179 b -176 0 -216 37 -176 0 b -107 84 -176 0 -145 37 b -31 174 -36 173 -38 172 b -25 174 -29 174 -28 174 b -16 173 -23 174 -19 173 b 147 11 -13 172 35 123 l 157 -1 l 160 1 l 163 4 l 163 130 b 164 260 163 256 163 258 b 175 273 166 266 170 270 "},v2a:{x_min:-21.78125,x_max:366.140625,ha:374,o:"m 276 1378 b 284 1379 279 1379 281 1379 b 306 1360 292 1379 298 1374 b 352 1247 326 1326 343 1286 b 366 1139 362 1213 366 1175 b 347 1009 366 1093 359 1049 l 344 1002 l 347 992 b 352 971 348 986 351 977 b 366 863 362 936 366 899 b 347 732 366 818 359 773 l 344 725 l 347 716 b 352 695 348 710 351 700 b 366 588 362 659 366 623 b 223 262 366 464 314 345 b 189 233 212 252 212 252 b 35 76 126 183 73 129 b -1 16 20 56 2 27 b -19 4 -4 9 -12 4 l -21 4 l -21 137 l -21 270 l -17 270 b 186 344 59 281 134 308 b 319 606 270 399 319 499 b 317 650 319 620 319 635 l 315 659 l 314 655 b 223 537 288 607 258 570 b 189 509 212 528 212 528 b 35 352 126 459 73 405 b -1 292 20 333 2 303 b -19 280 -4 285 -12 280 l -21 280 l -21 413 l -21 546 l -17 546 b 186 620 59 557 134 584 b 319 882 270 675 319 775 b 317 925 319 896 319 911 l 315 935 l 314 931 b 223 813 288 884 258 846 b 189 785 212 805 212 805 b 35 628 126 735 73 681 b -1 569 20 609 2 580 b -19 556 -4 562 -12 556 l -21 556 l -21 689 l -21 823 l -17 823 b 202 907 68 835 152 867 b 319 1157 280 968 319 1061 b 270 1338 319 1218 303 1281 b 262 1358 264 1349 262 1353 b 262 1364 262 1360 262 1363 b 276 1378 265 1371 269 1376 "},v2c:{x_min:-597.53125,x_max:596.171875,ha:608,o:"m -413 173 b -408 174 -412 174 -409 174 b -397 173 -404 174 -400 173 b -308 86 -394 172 -374 151 b -223 0 -261 37 -223 0 b -153 84 -223 0 -191 37 b -77 174 -83 173 -84 172 b -72 174 -76 174 -74 174 b -62 173 -68 174 -63 173 b 25 86 -59 172 -39 151 b 112 0 73 37 111 0 b 181 84 112 0 144 37 b 257 174 251 173 251 172 b 262 174 258 174 261 174 b 273 173 266 174 270 173 b 436 9 276 172 347 101 l 447 -1 l 477 36 b 522 79 511 79 513 79 l 522 79 b 552 51 533 79 539 73 b 596 -112 582 6 596 -51 b 567 -262 596 -161 586 -213 b 539 -322 558 -287 544 -316 b 524 -327 534 -326 529 -327 b 504 -315 515 -327 507 -323 b 503 -308 503 -312 503 -309 b 511 -285 503 -302 504 -297 b 555 -113 540 -227 555 -169 b 544 -34 555 -86 551 -59 b 522 19 540 -16 530 8 l 521 22 l 481 -26 l 405 -122 b 353 -176 366 -172 362 -176 b 349 -176 352 -176 351 -176 b 253 -87 341 -176 347 -180 b 167 0 206 -38 167 0 b 99 -86 167 0 136 -38 b 21 -174 27 -174 28 -173 b 17 -176 20 -176 19 -176 b 6 -174 13 -176 9 -174 b -81 -87 4 -173 -14 -152 b -167 0 -129 -38 -167 0 b -236 -86 -167 0 -198 -38 b -313 -174 -307 -174 -306 -173 b -318 -176 -314 -176 -315 -176 b -328 -174 -321 -176 -325 -174 b -491 -12 -330 -173 -367 -137 l -503 0 l -530 -34 b -570 -77 -562 -73 -564 -76 b -577 -79 -571 -79 -574 -79 b -597 -58 -588 -79 -597 -69 b -596 -49 -597 -55 -597 -52 b -417 172 -593 -43 -423 167 b -413 173 -417 172 -415 173 "},v2d:{x_min:0,x_max:438.28125,ha:447,o:"m 212 190 b 219 191 213 191 216 191 b 236 176 225 191 228 190 b 419 18 277 105 341 49 b 436 5 431 13 434 11 b 438 -1 438 4 438 1 b 424 -16 438 -8 432 -13 b 356 -49 409 -20 379 -36 b 234 -180 306 -83 258 -133 b 219 -192 230 -188 224 -192 b 200 -176 213 -192 206 -187 b 9 -15 157 -102 89 -45 b 0 0 2 -12 0 -6 b 16 18 0 9 2 12 b 200 176 93 48 159 104 b 212 190 205 186 208 188 m 239 113 b 236 117 238 116 238 117 b 230 108 235 117 234 115 b 92 -15 196 58 140 8 b 88 -18 91 -16 88 -18 b 92 -20 88 -18 91 -19 b 198 -116 130 -43 166 -74 b 200 -117 200 -117 200 -117 b 201 -117 200 -117 201 -117 b 264 -43 212 -98 242 -62 b 345 15 288 -19 321 4 b 348 18 347 16 348 16 b 344 20 348 18 347 19 b 239 113 307 41 266 79 "},v2f:{x_min:-1.359375,x_max:680.5625,ha:694,o:"m 597 1042 b 604 1042 600 1042 602 1042 b 642 1002 627 1042 642 1022 b 619 966 642 988 635 974 b 439 927 574 942 503 927 l 426 927 l 426 921 b 430 838 428 893 430 866 b 345 480 430 696 398 560 b 179 391 307 423 249 391 b 156 392 171 391 164 392 b 138 394 149 394 142 394 b 103 434 115 396 103 416 b 129 471 103 451 111 466 b 141 474 133 473 137 474 b 172 459 153 474 164 469 b 181 455 175 456 176 455 b 187 456 182 455 185 455 b 253 520 212 460 234 483 b 315 836 294 605 315 714 b 311 928 315 867 314 898 b 302 945 310 943 311 942 b 245 953 283 950 262 953 b 130 891 193 953 149 931 b 84 860 119 870 102 860 b 36 905 61 860 39 877 b 36 910 36 907 36 909 b 80 970 36 931 50 949 b 249 1017 125 1000 187 1017 b 322 1009 273 1017 299 1014 l 341 1003 b 436 991 372 995 406 991 b 577 1031 495 991 545 1004 b 597 1042 583 1038 590 1041 m 416 360 b 424 360 419 360 421 360 b 481 309 454 360 479 338 b 503 145 484 280 495 199 b 585 -185 525 16 555 -106 b 630 -245 596 -213 613 -237 l 634 -247 l 638 -245 b 647 -244 641 -245 645 -244 b 680 -278 666 -244 680 -262 b 664 -308 680 -290 675 -301 b 638 -312 658 -310 650 -312 b 613 -309 631 -312 623 -310 b 477 -201 555 -303 502 -260 b 417 -2 460 -159 434 -72 b 416 5 417 1 416 5 b 416 5 416 5 416 5 b 411 -5 415 5 413 0 b 359 -97 397 -33 377 -70 b 353 -106 355 -102 353 -105 b 359 -112 353 -108 355 -109 b 409 -130 375 -123 390 -129 b 426 -134 420 -130 421 -131 b 431 -147 428 -137 431 -141 b 420 -162 431 -152 427 -159 b 382 -169 409 -166 396 -169 b 323 -155 363 -169 341 -165 l 317 -152 l 314 -155 b 62 -303 240 -240 148 -295 b 36 -305 55 -305 44 -305 b 23 -303 29 -305 24 -305 b -1 -273 6 -299 -1 -287 b 31 -240 -1 -256 10 -240 b 36 -240 32 -240 34 -240 b 42 -241 38 -241 39 -241 b 134 -204 63 -241 99 -226 b 367 288 265 -115 357 81 b 375 330 368 313 370 320 b 416 360 383 347 400 358 m 360 -359 b 379 -359 363 -359 371 -359 b 424 -360 396 -359 416 -359 b 646 -502 536 -373 624 -430 b 649 -527 649 -510 649 -519 b 530 -673 649 -578 604 -635 l 521 -677 l 529 -681 b 653 -811 592 -714 637 -762 b 660 -853 658 -827 660 -839 b 645 -911 660 -873 656 -892 b 426 -1021 608 -981 519 -1021 b 283 -989 377 -1021 328 -1011 b 235 -949 249 -972 239 -964 b 234 -936 234 -946 234 -941 b 234 -928 234 -934 234 -931 l 235 -925 l 234 -927 l 225 -934 b 87 -982 186 -966 138 -982 b 80 -982 85 -982 83 -982 b 55 -981 70 -981 58 -981 b 17 -943 32 -981 17 -964 b 54 -904 17 -921 35 -904 b 78 -914 62 -904 72 -909 l 83 -918 l 88 -918 b 190 -831 122 -918 166 -881 b 269 -506 242 -727 269 -612 b 268 -462 269 -492 269 -477 b 266 -449 266 -458 266 -452 b 265 -444 266 -445 266 -444 b 257 -446 264 -444 261 -445 b 132 -545 196 -470 152 -505 b 88 -573 122 -563 104 -573 b 39 -523 63 -573 39 -553 b 63 -476 39 -505 44 -494 b 360 -359 136 -408 235 -369 m 419 -424 b 393 -423 411 -423 406 -423 l 375 -423 l 377 -426 b 379 -439 377 -427 378 -434 b 383 -510 382 -463 383 -487 b 314 -811 383 -609 360 -710 b 266 -893 296 -850 285 -870 b 264 -898 265 -896 264 -898 l 264 -898 b 264 -898 264 -898 264 -898 b 268 -898 264 -898 266 -898 b 273 -898 270 -898 272 -898 b 300 -909 283 -898 291 -900 b 426 -957 340 -941 385 -957 b 476 -949 443 -957 460 -954 b 547 -853 522 -931 547 -893 b 485 -745 547 -816 526 -775 b 397 -707 460 -727 432 -714 b 366 -675 375 -703 366 -692 b 396 -642 366 -657 377 -645 b 530 -557 455 -637 511 -601 b 536 -527 534 -548 536 -537 b 419 -424 536 -480 490 -437 "},v30:{x_min:-21.78125,x_max:367.5,ha:375,o:"m 276 1900 b 284 1901 279 1900 281 1901 b 306 1883 291 1901 298 1896 b 367 1686 347 1825 367 1757 b 343 1558 367 1643 359 1600 l 338 1549 l 343 1537 b 367 1411 359 1497 367 1454 b 343 1282 367 1367 359 1324 l 338 1272 l 343 1261 b 367 1135 359 1221 367 1178 b 343 1007 367 1090 359 1047 l 338 996 l 343 985 b 367 859 359 945 367 902 b 343 731 367 814 359 771 l 338 720 l 343 709 b 367 582 359 667 367 626 b 289 362 367 503 340 426 b 239 312 276 345 259 330 b 29 77 152 237 76 152 b -1 18 14 54 2 30 b -19 4 -4 11 -12 4 l -21 4 l -21 133 l -20 260 l -13 262 b 98 299 17 269 62 284 b 111 305 103 302 110 305 b 167 334 123 310 156 327 b 319 595 264 391 319 491 b 313 659 319 616 318 638 b 310 667 311 664 311 667 b 307 663 310 667 308 666 b 240 588 289 637 269 614 b 16 331 141 505 62 413 b -1 294 8 316 1 302 b -19 280 -4 287 -12 280 l -21 280 l -21 408 l -20 537 l -13 538 b 98 576 17 545 62 560 b 111 581 103 578 110 581 b 167 610 123 587 156 603 b 319 871 264 667 319 767 b 313 935 319 892 318 913 b 310 942 311 941 311 942 b 307 939 310 942 308 941 b 240 864 289 913 269 889 b 16 607 141 781 62 689 b -1 570 8 592 1 578 b -19 556 -4 563 -12 556 l -21 556 l -21 684 l -20 813 l -13 814 b 98 852 17 821 62 836 b 111 857 103 855 110 857 b 167 886 123 863 156 880 b 319 1147 264 943 319 1043 b 313 1211 319 1168 318 1189 b 310 1218 311 1217 311 1218 b 307 1215 310 1218 308 1217 b 240 1140 289 1188 269 1165 b 16 884 141 1057 62 966 b -1 846 8 868 1 855 b -19 832 -4 839 -12 832 l -21 832 l -21 960 l -20 1089 l -13 1090 b 98 1128 17 1097 62 1111 b 111 1134 103 1131 110 1134 b 167 1163 123 1139 156 1156 b 319 1424 264 1220 319 1320 b 313 1486 319 1444 318 1465 b 310 1494 311 1493 311 1494 b 307 1492 310 1494 308 1493 b 240 1417 289 1464 269 1442 b 16 1160 141 1333 62 1242 b -1 1121 8 1145 1 1131 b -19 1109 -4 1115 -12 1109 l -21 1109 l -21 1236 l -20 1365 l -13 1367 b 98 1404 17 1374 62 1388 b 111 1410 103 1407 110 1410 b 250 1508 172 1437 215 1467 b 319 1701 296 1564 319 1633 b 270 1859 319 1757 303 1814 b 262 1882 265 1868 262 1875 b 276 1900 262 1890 266 1896 "},v31:{x_min:0,x_max:386.5625,ha:394,o:"m 0 173 l 0 347 l 193 347 l 386 347 l 386 173 l 386 0 l 193 0 l 0 0 l 0 173 "},v33:{x_min:-423.3125,x_max:421.9375,ha:431,o:"m -10 276 b -2 277 -8 277 -5 277 b 17 265 5 277 13 273 b 19 163 19 260 19 260 l 19 68 l 39 45 b 277 -95 122 -34 200 -81 b 289 -97 281 -97 285 -97 b 378 0 332 -97 371 -54 b 378 11 378 4 378 6 b 302 83 378 55 345 83 b 242 66 283 83 262 77 b 208 56 231 59 219 56 b 148 120 175 56 148 81 b 200 186 148 151 164 172 b 261 198 220 194 240 198 b 420 45 341 198 411 137 b 421 22 421 37 421 29 b 257 -198 421 -86 347 -188 b 242 -198 251 -198 247 -198 b 20 -105 181 -198 95 -163 l 19 -104 l 19 -183 b 19 -216 19 -195 19 -206 b 12 -273 19 -272 17 -267 b -2 -278 8 -277 2 -278 b -21 -266 -10 -278 -19 -274 b -23 -165 -23 -263 -23 -262 l -23 -69 l -44 -47 b -250 86 -117 23 -183 66 b -295 94 -270 93 -284 94 b -315 91 -302 94 -308 94 b -381 5 -356 81 -381 43 b -355 -56 -381 -16 -372 -40 b -299 -81 -338 -73 -319 -81 b -246 -68 -283 -81 -265 -77 b -212 -58 -234 -61 -223 -58 b -168 -77 -196 -58 -179 -65 b -151 -122 -156 -90 -151 -105 b -179 -174 -151 -141 -160 -162 b -239 -195 -194 -184 -217 -192 b -257 -197 -245 -195 -250 -197 b -423 -5 -349 -197 -423 -113 b -423 0 -423 -4 -423 -1 b -277 194 -420 97 -362 173 b -247 197 -268 197 -258 197 b -24 104 -185 197 -100 162 l -23 102 l -23 181 b -21 265 -23 260 -23 260 b -10 276 -20 269 -14 274 "},v34:{x_min:0,x_max:622.03125,ha:635,o:"m 398 417 b 406 419 401 419 404 419 b 427 398 417 419 427 409 b 427 391 427 395 427 392 b 34 -274 424 385 38 -272 b 20 -280 29 -278 25 -280 b 0 -259 9 -280 0 -270 b 0 -252 0 -256 0 -254 b 393 413 2 -247 389 410 b 398 417 394 415 397 416 m 592 417 b 600 419 594 419 597 419 b 622 398 611 419 622 409 b 620 391 622 395 620 392 b 227 -274 617 385 231 -272 b 213 -280 223 -278 219 -280 b 193 -259 202 -280 193 -270 b 194 -252 193 -256 193 -254 b 586 413 196 -247 582 410 b 592 417 588 415 590 416 "},v36:{x_min:-1.359375,x_max:1064.390625,ha:1086,o:"m 296 692 b 314 694 302 694 307 694 b 386 685 337 694 366 689 b 548 498 480 660 548 580 b 548 481 548 492 548 487 b 455 395 541 426 499 395 b 370 462 420 395 383 417 b 362 496 364 477 362 488 b 377 514 362 509 367 514 b 393 501 386 514 390 510 b 432 474 397 484 413 474 b 470 487 445 474 458 478 b 491 530 484 496 491 510 b 490 544 491 534 491 539 b 333 660 479 606 411 657 l 323 662 l 315 646 b 269 524 285 591 269 556 b 321 431 269 492 287 466 b 349 395 338 413 343 408 b 363 342 359 378 363 362 b 359 312 363 333 362 322 b 285 158 348 266 318 206 b 281 152 283 155 281 152 b 281 152 281 152 281 152 b 287 154 283 152 284 152 b 318 155 298 154 308 155 b 461 98 371 155 419 136 l 464 97 l 483 112 b 503 129 494 120 503 127 b 504 130 503 129 504 129 b 503 138 504 131 503 134 b 500 180 500 152 500 166 b 553 326 500 238 518 288 b 604 366 560 331 592 358 b 649 381 617 376 632 381 b 696 362 665 381 681 374 b 724 302 714 347 724 324 b 695 238 724 278 714 255 b 660 210 691 234 662 212 b 579 148 658 209 582 151 b 579 148 579 148 579 148 b 596 106 579 144 589 119 b 622 77 604 88 609 83 b 657 69 632 72 645 69 b 748 112 688 69 721 84 b 755 123 754 117 755 120 b 755 127 755 124 755 126 b 751 165 752 137 751 151 b 758 219 751 183 754 202 b 894 387 774 290 820 347 b 896 390 896 388 896 388 b 891 398 896 391 895 392 b 622 560 827 477 730 535 b 600 580 605 564 600 569 b 617 596 600 591 607 596 b 628 595 622 596 624 596 b 1057 248 846 552 1020 412 b 1064 191 1061 229 1064 209 b 922 0 1064 94 1005 9 b 902 -1 916 -1 909 -1 b 774 76 847 -1 800 26 b 769 83 770 81 770 83 b 769 81 769 83 769 83 b 627 -1 733 29 677 -1 b 548 27 597 -1 570 8 b 515 88 537 37 525 61 l 513 95 l 510 93 l 453 45 b 390 0 396 0 396 0 b 390 0 390 0 390 0 b 374 15 381 0 377 4 b 268 105 359 69 314 105 b 250 104 262 105 257 105 l 243 102 l 234 90 b 155 1 201 49 159 2 b 147 -1 152 0 149 -1 b 130 15 138 -1 130 6 b 132 20 130 18 132 19 b 136 31 133 22 134 27 b 220 131 149 74 178 109 b 231 137 225 134 230 136 b 302 278 280 202 302 244 b 265 335 302 299 295 309 b 209 442 234 363 213 402 b 209 455 209 446 209 451 b 279 648 209 502 232 564 l 285 659 l 283 659 b 176 627 238 653 210 645 b 57 477 111 594 66 538 b 55 459 55 471 55 464 b 72 409 55 437 61 415 b 93 403 78 405 87 403 b 152 467 123 403 151 431 b 168 488 153 483 157 488 b 185 462 181 488 185 483 l 185 460 b 137 344 183 409 168 369 b 78 322 119 328 98 322 b 13 360 50 322 25 335 b -1 426 4 380 -1 402 b 89 610 -1 488 32 559 b 296 692 147 659 210 685 m 926 348 b 921 353 924 351 922 353 b 914 348 920 353 918 351 b 823 167 857 306 823 237 b 828 124 823 154 826 138 b 890 31 837 79 862 40 b 896 31 892 31 894 31 b 956 104 916 31 940 59 b 970 191 965 129 970 159 b 966 241 970 208 969 224 b 926 348 959 277 945 313 m 627 326 b 619 326 624 326 622 326 b 598 316 611 326 604 323 b 568 215 579 288 568 255 b 568 208 568 213 568 210 b 571 183 570 195 570 184 l 571 183 b 594 201 571 183 582 191 l 634 231 b 660 259 653 247 656 248 b 664 278 662 266 664 272 b 627 326 664 299 649 320 "},v38:{x_min:-1.359375,x_max:651.96875,ha:665,o:"m 389 644 b 405 645 394 645 400 645 b 504 566 450 645 492 613 b 507 541 506 557 507 549 b 480 471 507 514 498 489 l 477 467 l 483 470 b 609 591 539 485 586 531 b 613 601 611 595 613 599 b 631 609 619 607 624 609 b 651 588 641 609 651 602 b 200 -946 651 584 204 -941 b 182 -957 197 -953 190 -957 b 163 -945 174 -957 166 -953 b 161 -939 161 -942 161 -942 b 217 -743 161 -931 170 -904 b 272 -555 247 -639 272 -555 b 272 -555 272 -555 272 -555 b 264 -560 272 -555 268 -557 b 140 -603 227 -589 182 -603 b 36 -567 102 -603 65 -592 b -1 -487 12 -548 -1 -517 b 17 -427 -1 -466 5 -445 b 103 -380 38 -395 70 -380 b 191 -433 137 -380 172 -398 b 205 -484 201 -448 205 -466 b 178 -553 205 -509 196 -535 l 175 -557 l 182 -555 b 307 -435 236 -539 284 -494 b 372 -213 308 -430 372 -215 b 372 -213 372 -213 372 -213 b 364 -219 372 -213 368 -216 b 240 -262 328 -247 283 -262 b 137 -226 202 -262 166 -249 b 99 -145 112 -206 99 -176 b 118 -84 99 -124 106 -104 b 204 -38 138 -54 171 -38 b 292 -91 238 -38 273 -56 b 306 -141 302 -106 306 -124 b 279 -212 306 -167 296 -194 l 276 -215 l 281 -213 b 408 -93 336 -198 385 -151 b 473 129 409 -88 473 127 b 473 129 473 129 473 129 b 465 122 473 129 469 126 b 341 80 428 94 383 80 b 236 115 303 80 266 91 b 200 195 213 136 200 165 b 217 256 200 217 206 238 b 304 303 239 287 272 303 b 393 249 338 303 374 285 b 406 199 402 234 406 217 b 379 129 406 173 397 148 l 377 126 l 382 127 b 509 248 436 142 485 190 b 574 470 510 254 574 469 b 574 470 574 470 574 470 b 566 464 574 470 570 467 b 442 421 529 435 484 421 b 337 458 404 421 367 433 b 300 537 313 478 300 508 b 389 644 300 585 334 635 "},v3b:{x_min:0,x_max:484.5625,ha:494,o:"m 228 245 b 239 247 234 247 239 247 b 243 247 240 247 242 247 b 303 238 257 247 287 242 b 484 -2 417 208 484 104 b 412 -177 484 -65 461 -127 b 243 -248 363 -226 303 -248 b 6 -63 138 -248 36 -180 b 0 -1 1 -41 0 -20 b 228 245 0 127 98 240 m 255 181 b 240 183 247 183 245 183 b 232 181 238 183 235 183 b 142 152 200 180 168 170 l 138 149 l 190 97 l 242 44 l 294 97 l 345 149 l 340 152 b 255 181 315 169 284 180 m 147 -54 l 197 -1 l 147 51 l 95 104 l 91 99 b 62 -1 72 70 62 34 b 66 -43 62 -15 63 -29 b 91 -101 72 -63 80 -84 l 95 -106 l 147 -54 m 393 99 b 389 104 390 102 389 104 b 337 51 389 104 366 80 l 285 -1 l 337 -54 l 389 -106 l 393 -101 b 421 -1 412 -72 421 -36 b 393 99 421 34 412 69 m 294 -98 b 242 -45 265 -69 242 -45 b 190 -98 242 -45 219 -69 l 138 -151 l 142 -154 b 242 -184 172 -174 206 -184 b 340 -154 276 -184 311 -174 l 345 -151 l 294 -98 "},v3c:{x_min:0,x_max:450.53125,ha:460,o:"m 189 302 b 204 303 193 302 198 303 b 303 224 250 303 292 270 b 306 199 304 216 306 208 b 279 129 306 173 296 147 l 276 126 l 281 127 b 408 249 337 142 385 190 b 412 259 409 254 412 258 b 430 267 417 265 423 267 b 450 247 441 267 450 259 b 200 -605 450 242 204 -599 b 182 -616 197 -612 190 -616 b 163 -602 174 -616 166 -610 b 161 -598 161 -601 161 -601 b 217 -402 161 -589 170 -562 b 272 -213 247 -298 272 -213 b 272 -213 272 -213 272 -213 b 264 -219 272 -213 268 -216 b 140 -262 227 -247 182 -262 b 36 -226 102 -262 65 -249 b 0 -145 12 -206 0 -176 b 17 -84 0 -124 5 -104 b 103 -38 38 -54 70 -38 b 191 -91 137 -38 172 -56 b 205 -141 201 -106 205 -124 b 178 -212 205 -167 196 -194 l 175 -215 l 182 -213 b 307 -93 236 -198 284 -151 b 372 129 308 -88 372 127 b 372 129 372 129 372 129 b 364 122 372 129 368 126 b 240 80 328 94 283 80 b 137 115 202 80 166 91 b 99 194 111 136 99 165 b 189 302 99 244 133 292 "},v3e:{x_min:0,x_max:406.96875,ha:415,o:"m 21 183 b 28 183 24 183 25 183 b 42 181 34 183 39 183 b 127 108 47 179 47 179 b 202 41 168 72 202 41 b 279 108 204 41 238 72 b 357 177 321 145 356 176 b 375 183 363 181 370 183 b 406 151 392 183 406 169 b 404 137 406 147 405 141 b 322 62 401 131 398 129 b 251 0 284 27 251 0 b 322 -63 251 -1 284 -29 b 404 -138 398 -130 401 -133 b 406 -152 405 -142 406 -148 b 375 -184 406 -170 392 -184 b 357 -179 370 -184 363 -183 b 279 -109 356 -177 321 -147 b 202 -43 238 -73 204 -43 b 127 -109 202 -43 168 -73 b 49 -179 85 -147 50 -177 b 31 -184 43 -183 36 -184 b 0 -152 13 -184 0 -170 b 2 -138 0 -148 0 -142 b 83 -63 5 -133 8 -130 b 155 0 122 -29 155 -1 b 83 62 155 0 122 27 b 8 129 43 97 10 127 b 0 151 2 136 0 144 b 21 183 0 165 8 177 "},v3f:{x_min:-24.5,x_max:317.140625,ha:324,o:"m -24 -147 l -24 -5 l -20 -5 b -1 -19 -12 -5 -4 -11 b 58 -123 6 -43 31 -86 b 196 -278 93 -173 134 -219 b 317 -570 274 -356 317 -460 b 294 -713 317 -617 308 -666 l 289 -724 l 294 -735 b 317 -873 308 -780 317 -827 b 235 -1132 317 -963 288 -1054 b 209 -1165 228 -1140 224 -1146 b 189 -1177 204 -1172 196 -1177 b 171 -1164 182 -1177 175 -1172 b 168 -1154 170 -1161 168 -1159 b 181 -1132 168 -1149 172 -1142 b 269 -891 238 -1064 269 -975 b 269 -881 269 -886 269 -884 b 262 -814 269 -857 265 -827 b 258 -800 261 -811 259 -806 b 142 -628 240 -731 198 -667 b -8 -589 112 -606 47 -589 b -20 -589 -13 -589 -19 -589 l -24 -589 l -24 -449 l -24 -308 l -20 -308 b -1 -322 -12 -308 -4 -313 b 58 -424 6 -345 31 -388 b 194 -580 93 -476 136 -523 b 259 -660 221 -606 245 -635 b 261 -663 259 -662 261 -663 b 264 -656 262 -663 262 -660 b 269 -587 268 -632 269 -610 b 264 -521 269 -566 268 -544 b 262 -512 264 -517 262 -513 b 258 -498 261 -509 259 -503 b 142 -326 240 -428 198 -365 b -8 -287 112 -303 47 -288 b -20 -287 -13 -287 -19 -287 l -24 -287 l -24 -147 "},v40:{x_min:-1.359375,x_max:436.921875,ha:446,o:"m 213 205 b 217 205 215 205 216 205 b 234 194 224 205 234 199 b 236 187 234 194 235 190 l 245 167 l 261 129 l 270 106 b 355 -61 294 54 329 -13 b 420 -163 381 -105 402 -138 b 436 -188 435 -184 436 -184 b 436 -191 436 -190 436 -190 b 421 -206 436 -201 431 -206 l 421 -206 l 416 -206 l 405 -201 b 217 -158 347 -172 283 -158 b 31 -201 153 -158 88 -172 l 20 -206 l 14 -206 l 14 -206 b 0 -191 5 -206 0 -201 b -1 -188 0 -190 -1 -190 b 14 -163 -1 -186 0 -184 b 95 -34 36 -136 72 -77 b 166 106 119 8 148 68 l 175 129 l 183 148 l 200 188 b 213 205 205 199 208 202 "},v41:{x_min:-1.359375,x_max:556.6875,ha:568,o:"m 294 322 b 318 323 299 322 308 323 b 360 320 334 323 352 322 b 526 217 430 310 490 273 b 543 166 537 202 543 184 b 447 70 543 117 503 70 b 445 70 447 70 446 70 b 359 159 394 72 359 113 b 368 201 359 173 362 187 b 442 245 382 229 412 245 b 455 244 446 245 451 245 b 460 244 458 244 460 244 b 460 244 460 244 460 244 b 454 248 460 244 458 245 b 325 291 417 276 372 291 b 285 287 313 291 299 290 b 144 -2 183 269 144 190 b 281 -290 144 -208 179 -280 b 304 -291 289 -291 298 -291 b 524 -105 412 -291 506 -212 b 541 -84 526 -88 530 -84 b 556 -101 551 -84 556 -90 b 549 -138 556 -111 553 -122 b 334 -322 521 -237 435 -310 b 302 -324 323 -323 313 -324 b 13 -101 172 -324 54 -234 b -1 -1 4 -68 -1 -34 b 294 322 -1 161 121 303 "},v42:{x_min:-348.4375,x_max:24.5,ha:25,o:"m -330 155 b -322 156 -329 156 -326 156 b -315 156 -319 156 -317 156 b -298 147 -311 155 -308 154 b -19 30 -224 98 -122 55 l 2 26 b 24 -1 17 22 24 13 b 2 -27 24 -15 17 -23 l -19 -31 b -298 -148 -122 -56 -224 -99 b -322 -158 -313 -158 -315 -158 b -348 -131 -338 -158 -348 -145 b -344 -117 -348 -127 -347 -122 b -328 -104 -341 -112 -338 -111 b -127 -8 -269 -65 -202 -33 b -106 0 -115 -4 -106 -1 b -127 6 -106 0 -115 2 b -328 102 -202 31 -269 63 b -344 116 -338 109 -341 111 b -348 130 -347 120 -348 124 b -330 155 -348 141 -341 152 "},v43:{x_min:-442.359375,x_max:441,ha:450,o:"m -31 487 b -1 488 -21 488 -10 488 b 434 104 216 488 397 330 b 441 27 438 79 441 47 b 439 12 441 20 439 15 b 419 0 435 4 427 0 b 404 5 413 0 408 1 b 398 30 400 11 398 13 b 0 351 390 213 213 351 b -59 348 -20 351 -39 349 b -400 30 -251 324 -393 191 b -405 5 -400 13 -401 11 b -420 0 -409 1 -415 0 b -441 12 -428 0 -436 4 b -442 27 -441 15 -442 20 b -435 104 -442 47 -439 79 b -31 487 -401 316 -235 474 m -13 131 b -1 133 -9 133 -5 133 b 51 105 19 133 39 123 b 61 70 58 95 61 83 b 51 34 61 58 58 45 b -1 6 39 16 19 6 b -46 27 -17 6 -34 13 b -62 69 -57 38 -62 54 b -13 131 -62 98 -44 124 "},v44:{x_min:-21.78125,x_max:251.8125,ha:257,o:"m -8 631 b -1 632 -6 632 -4 632 b 19 620 8 632 16 628 b 20 383 20 616 20 616 l 20 148 l 21 151 b 137 199 59 183 99 199 b 182 191 152 199 167 197 b 251 84 227 176 251 134 b 228 0 251 58 243 29 b 100 -142 206 -40 178 -72 l 23 -215 b 0 -229 9 -229 6 -229 b -20 -216 -9 -229 -17 -224 l -21 -212 l -21 201 l -21 616 l -20 620 b -8 631 -17 624 -13 630 m 110 131 b 96 133 106 133 100 133 b 89 133 93 133 91 133 b 24 87 63 129 40 113 l 20 80 l 20 -37 l 20 -156 l 23 -152 b 144 81 96 -72 144 20 l 144 83 b 110 131 144 113 134 126 "},v45:{x_min:-402.890625,x_max:401.53125,ha:410,o:"m -10 273 b -4 274 -9 273 -6 274 b 16 262 4 274 12 269 b 17 158 17 259 17 259 l 17 56 l 62 112 b 117 174 110 172 110 172 b 122 174 118 174 119 174 b 132 173 125 174 129 173 b 295 11 134 172 171 134 l 307 -1 l 336 34 b 374 76 366 72 368 74 b 381 77 375 77 378 77 b 401 56 392 77 401 68 b 400 48 401 54 401 51 b 223 -172 397 41 230 -166 b 210 -176 220 -174 215 -176 b 201 -174 206 -176 204 -176 b 112 -87 198 -173 178 -152 b 27 0 65 -38 27 0 b 21 -6 27 0 24 -2 l 17 -12 l 17 -147 b 17 -210 17 -173 17 -194 b 10 -292 17 -297 16 -287 b -2 -299 6 -297 2 -299 b -21 -287 -10 -299 -19 -295 b -24 -174 -23 -284 -23 -284 l -24 -63 l -66 -117 b -121 -176 -110 -170 -114 -176 b -125 -176 -122 -176 -123 -176 b -296 -12 -134 -174 -125 -184 l -308 0 l -337 -34 b -375 -77 -367 -73 -370 -76 b -382 -79 -377 -79 -379 -79 b -402 -58 -393 -79 -402 -69 b -401 -49 -402 -55 -402 -52 b -224 170 -398 -43 -231 165 b -212 174 -221 173 -216 174 b -202 173 -208 174 -205 174 b -39 11 -200 172 -151 122 l -28 -1 l -25 1 l -24 4 l -24 130 b -23 260 -24 256 -24 258 b -10 273 -20 266 -16 270 "},v46:{x_min:0,x_max:627.46875,ha:640,o:"m 306 190 b 314 191 308 191 311 191 b 326 184 318 191 322 190 l 336 173 b 510 52 377 127 442 80 b 515 49 513 51 515 49 b 611 16 537 40 579 24 b 627 0 624 13 627 9 b 607 -18 627 -11 624 -13 b 330 -181 490 -49 389 -109 b 314 -192 323 -190 319 -192 b 306 -191 311 -192 308 -192 b 294 -177 302 -188 302 -188 b 257 -140 287 -170 265 -148 b 19 -18 193 -84 114 -44 b 0 0 2 -13 0 -11 b 16 16 0 9 2 13 b 110 49 47 24 89 40 b 117 52 111 49 114 51 b 145 65 126 56 130 58 b 281 163 200 93 245 124 b 300 186 288 170 291 174 b 306 190 300 187 303 188 m 317 137 b 313 142 315 141 314 142 b 308 137 313 142 311 141 b 161 4 276 84 220 33 b 155 0 159 1 155 0 b 163 -4 155 0 159 -2 b 308 -138 220 -34 276 -84 b 313 -142 311 -141 313 -142 b 317 -138 314 -142 315 -141 b 464 -4 351 -84 406 -34 b 470 0 468 -2 470 0 b 464 4 470 0 468 1 b 317 137 406 33 351 84 "},v47:{x_min:-24.5,x_max:315.78125,ha:322,o:"m -24 -145 l -24 -5 l -20 -5 b 1 -26 -10 -5 -6 -9 b 175 -241 31 -86 96 -166 b 314 -548 259 -323 304 -420 b 315 -589 315 -555 315 -571 b 314 -630 315 -606 315 -623 b 298 -730 311 -664 306 -699 l 295 -742 l 296 -748 b 314 -850 304 -778 311 -813 b 315 -892 315 -857 315 -874 b 314 -932 315 -909 315 -925 b 298 -1032 311 -967 306 -1002 l 295 -1045 l 296 -1050 b 314 -1153 304 -1081 311 -1115 b 315 -1193 315 -1160 315 -1177 b 314 -1235 315 -1211 315 -1228 b 217 -1526 306 -1338 270 -1444 b 201 -1533 213 -1532 208 -1533 b 182 -1522 193 -1533 185 -1529 b 179 -1514 181 -1518 179 -1517 b 189 -1489 179 -1508 182 -1501 b 266 -1217 240 -1403 266 -1308 b 262 -1156 266 -1196 265 -1177 b 110 -907 247 -1043 190 -950 b 0 -889 87 -895 50 -889 l -1 -889 l -24 -889 l -24 -749 l -24 -610 l -20 -610 b 1 -631 -10 -610 -6 -614 b 175 -846 31 -691 96 -771 b 259 -956 213 -884 236 -914 b 265 -966 262 -961 264 -966 b 265 -966 265 -966 265 -966 b 265 -953 265 -964 265 -959 b 266 -920 266 -943 266 -932 b 262 -853 266 -898 265 -873 b 110 -605 247 -741 190 -648 b 0 -587 87 -592 50 -587 l -1 -587 l -24 -587 l -24 -448 l -24 -308 l -20 -308 b 1 -328 -10 -308 -6 -312 b 175 -544 31 -388 96 -469 b 259 -655 213 -581 236 -612 b 265 -663 262 -659 264 -663 b 265 -663 265 -663 265 -663 b 265 -650 265 -663 265 -657 b 266 -617 266 -641 266 -630 b 262 -551 266 -595 265 -570 b 110 -303 247 -438 190 -345 b 0 -284 87 -290 50 -284 l -1 -284 l -24 -284 l -24 -145 "},v49:{x_min:0,x_max:630.203125,ha:643,o:"m 308 204 b 314 205 310 205 313 205 b 326 201 319 205 323 204 b 355 154 328 199 338 180 b 401 83 362 142 392 95 l 409 72 b 431 41 412 66 424 49 b 619 -174 498 -51 570 -134 b 630 -192 626 -180 630 -186 b 626 -202 630 -195 628 -199 b 616 -206 623 -205 620 -206 b 552 -188 608 -206 592 -202 b 310 -155 488 -169 392 -155 b 268 -156 295 -155 281 -155 b 77 -188 197 -161 126 -173 b 13 -206 35 -202 20 -206 b 9 -206 12 -206 10 -206 b 0 -191 2 -202 0 -197 b 8 -176 0 -186 2 -180 b 204 49 58 -136 138 -43 l 220 72 l 227 83 b 295 188 245 108 281 166 b 308 204 299 197 304 202 m 315 147 b 314 147 315 147 314 147 b 314 147 314 147 314 147 b 306 129 314 145 310 138 l 296 105 b 281 72 292 97 284 77 l 274 56 b 181 -123 247 -4 212 -72 l 174 -134 l 176 -133 b 314 -123 215 -127 272 -123 b 451 -133 356 -123 413 -127 l 454 -134 l 449 -123 b 353 56 417 -72 381 -4 l 347 72 b 332 105 344 77 336 97 l 322 129 b 315 147 318 138 315 145 "},v4a:{x_min:70.78125,x_max:378.390625,ha:315,o:"m 246 373 b 254 373 249 373 251 373 b 372 324 303 373 360 351 b 378 302 377 317 378 309 b 338 251 378 278 362 255 b 328 249 334 249 332 249 b 283 294 303 249 283 270 b 288 315 283 301 284 308 b 289 319 289 317 289 319 b 289 319 289 319 289 319 b 283 320 289 320 287 320 b 270 322 279 322 274 322 b 206 288 242 322 215 308 b 206 283 206 287 206 285 b 257 223 206 267 230 238 b 284 206 272 213 277 210 b 351 90 328 173 351 130 b 340 47 351 74 348 59 b 205 -30 314 -2 264 -30 b 182 -29 198 -30 190 -30 b 84 15 147 -24 103 -5 b 70 48 74 24 70 36 b 108 99 70 70 85 94 b 121 102 112 101 117 102 b 167 56 147 102 167 80 b 159 31 167 48 164 40 l 156 26 l 157 26 b 190 20 167 22 178 20 b 220 26 201 20 212 22 b 258 65 243 34 258 51 b 257 70 258 66 258 69 b 204 126 249 94 234 109 b 114 258 148 158 114 209 b 125 302 114 273 118 288 b 246 373 147 342 193 370 "},v4b:{x_min:0,x_max:503.609375,ha:514,o:"m 274 430 b 277 430 276 430 277 430 b 310 394 296 430 310 415 b 308 383 310 391 308 387 b 306 367 307 381 307 374 b 236 120 298 305 272 210 b 40 -273 189 -5 125 -134 b 20 -287 35 -283 27 -287 b 5 -281 14 -287 9 -285 b 0 -267 1 -277 0 -273 b 9 -242 0 -262 2 -255 b 246 395 137 -12 232 242 b 274 430 249 416 257 427 m 468 430 b 472 430 469 430 470 430 b 503 394 490 430 503 415 b 502 383 503 391 503 387 b 499 367 502 381 500 374 b 431 120 491 305 465 210 b 234 -273 382 -5 318 -134 b 213 -287 228 -283 220 -287 b 198 -281 208 -287 202 -285 b 193 -267 194 -277 193 -273 b 202 -242 193 -262 196 -255 b 439 395 330 -12 426 242 b 468 430 442 416 451 427 "},v4d:{x_min:-311.6875,x_max:310.328125,ha:317,o:"m -9 388 b -2 390 -8 390 -5 390 b 5 388 1 390 4 390 b 19 378 10 387 16 383 b 23 333 23 371 23 371 b 24 298 23 299 24 298 b 81 276 34 298 65 285 b 213 91 145 240 190 177 b 224 24 217 76 224 36 b 257 24 224 24 235 24 b 299 19 292 24 292 24 b 310 -1 306 15 310 6 b 299 -23 310 -11 306 -19 b 257 -27 292 -27 292 -27 b 224 -29 235 -27 224 -29 b 213 -95 224 -40 217 -80 b 81 -280 190 -181 145 -244 b 24 -301 65 -290 34 -301 b 23 -335 24 -301 23 -303 l 23 -340 b 17 -381 23 -374 23 -374 b -1 -391 13 -388 5 -391 b -21 -381 -9 -391 -17 -388 b -27 -340 -27 -374 -27 -374 l -27 -335 b -28 -301 -27 -303 -27 -301 b -85 -280 -38 -301 -69 -290 b -217 -95 -149 -244 -194 -181 b -228 -29 -221 -80 -228 -40 b -259 -27 -228 -29 -238 -27 b -300 -23 -294 -27 -294 -27 b -311 -2 -307 -19 -311 -11 b -294 23 -311 8 -304 19 b -259 24 -291 23 -284 24 b -228 24 -239 24 -228 24 b -217 91 -228 36 -221 76 b -85 276 -194 177 -149 240 b -28 298 -69 285 -38 298 b -27 333 -27 298 -27 299 b -27 371 -27 362 -27 369 b -9 388 -24 378 -17 385 m -27 136 b -28 247 -27 197 -28 247 b -61 216 -31 247 -53 226 b -123 33 -95 172 -121 98 l -125 24 l -76 24 l -27 24 l -27 136 m 29 242 b 24 247 27 245 24 247 b 23 136 24 247 23 197 l 23 24 l 72 24 l 121 24 l 119 33 b 29 242 115 116 77 206 m -27 -140 l -27 -27 l -76 -27 l -125 -27 l -123 -36 b -61 -220 -121 -102 -95 -176 b -28 -251 -53 -230 -31 -251 b -27 -140 -28 -251 -27 -201 m 119 -36 l 121 -27 l 72 -27 l 23 -27 l 23 -140 b 24 -251 23 -201 24 -251 b 57 -220 27 -251 49 -230 b 119 -36 91 -176 117 -102 "},v4e:{x_min:0,x_max:239.5625,ha:244,o:"m 10 460 b 20 462 13 462 14 462 b 39 449 28 462 35 458 l 40 446 l 40 326 b 40 205 40 259 40 205 b 127 227 40 205 80 215 b 220 249 196 244 213 249 b 227 247 224 249 225 248 b 238 237 231 245 235 241 l 239 233 l 239 -106 l 239 -448 l 238 -451 b 219 -463 234 -459 225 -463 b 198 -451 210 -463 202 -459 l 197 -448 l 197 -324 b 197 -201 197 -248 197 -201 b 110 -223 196 -201 157 -210 b 17 -245 42 -240 24 -245 b 10 -242 13 -245 13 -244 b 0 -233 6 -241 2 -237 l 0 -230 l 0 108 l 0 446 l 0 449 b 10 460 2 453 6 458 m 197 22 b 197 70 197 41 197 58 b 196 116 197 113 197 116 l 196 116 b 118 97 196 116 160 106 l 40 77 l 40 -18 b 40 -112 40 -69 40 -112 l 119 -93 l 197 -73 l 197 22 "},v51:{x_min:-1.359375,x_max:455.96875,ha:465,o:"m 352 541 b 357 542 353 542 355 542 b 377 530 364 542 372 537 l 378 526 l 378 394 l 379 262 l 404 266 b 436 270 420 269 430 270 b 450 265 443 270 446 269 b 455 220 455 259 455 260 l 455 208 l 455 161 l 454 156 b 411 140 449 147 447 147 b 378 133 393 137 379 134 b 378 68 378 133 378 106 b 378 22 378 54 378 38 l 379 -87 l 404 -83 b 436 -79 420 -80 430 -79 b 450 -84 443 -79 446 -80 b 455 -129 455 -90 455 -88 l 455 -141 l 455 -188 l 454 -192 b 413 -209 449 -202 447 -202 b 382 -215 398 -212 383 -215 l 378 -215 l 378 -345 l 378 -380 b 375 -485 378 -484 378 -480 b 357 -494 371 -491 364 -494 b 340 -485 351 -494 344 -491 b 336 -383 337 -480 336 -484 l 336 -349 l 336 -223 l 334 -223 b 291 -231 334 -223 314 -227 l 247 -240 l 247 -371 l 246 -503 l 245 -506 b 225 -519 242 -514 234 -519 b 206 -506 219 -519 210 -514 l 205 -503 l 205 -376 l 205 -248 l 160 -256 l 115 -265 l 115 -396 l 115 -527 l 114 -531 b 95 -544 110 -539 102 -544 b 76 -531 87 -544 78 -539 l 73 -527 l 73 -399 b 73 -273 73 -330 73 -273 b 49 -277 73 -273 61 -274 b 17 -281 32 -280 24 -281 b 4 -276 10 -281 8 -280 b -1 -234 0 -269 -1 -272 b 0 -219 -1 -229 0 -224 l 0 -170 l 1 -167 b 10 -158 2 -163 6 -159 b 49 -149 13 -156 16 -155 l 73 -145 l 73 -34 b 73 76 73 26 73 76 b 49 72 73 76 61 74 b 17 68 32 69 24 68 b 4 73 10 68 8 69 b -1 115 0 80 -1 77 b 0 130 -1 120 0 124 l 0 179 l 1 181 b 10 191 2 186 6 190 b 49 199 13 192 16 194 l 73 204 l 73 338 b 73 374 73 352 73 365 b 77 483 73 484 73 477 b 95 492 81 489 88 492 b 111 483 100 492 107 489 b 115 378 115 477 115 483 l 115 342 b 117 212 115 223 115 212 b 204 229 117 212 200 227 l 205 229 l 205 365 l 205 502 l 206 505 b 225 517 210 513 219 517 b 245 505 234 517 242 513 l 246 502 l 247 369 l 247 237 l 249 237 b 336 254 253 238 336 254 b 337 390 336 254 337 302 l 337 526 l 338 530 b 352 541 341 535 347 539 m 336 15 b 336 126 336 102 336 126 l 336 126 b 291 117 336 126 315 122 l 247 109 l 247 -1 l 247 -112 l 249 -112 b 336 -95 253 -111 336 -95 b 336 15 336 -95 336 -56 m 205 -120 b 205 -55 205 -120 205 -93 b 205 -9 205 -41 205 -24 l 205 101 l 160 93 l 115 84 l 115 -26 b 115 -83 115 -49 115 -69 b 117 -137 115 -133 115 -137 b 205 -120 118 -137 204 -120 "},v52:{x_min:-10.890625,x_max:298.078125,ha:294,o:"m 138 473 b 142 474 140 473 141 474 b 164 459 148 474 153 470 b 191 402 183 442 191 423 b 181 353 191 388 187 371 b 178 349 179 352 178 349 b 179 348 178 348 179 348 b 185 349 181 348 182 348 b 255 376 210 355 234 363 b 272 381 264 381 266 381 b 298 355 287 381 298 370 b 288 330 298 348 298 345 b 171 34 238 254 194 141 b 166 13 168 16 168 16 b 144 1 161 5 152 1 b 121 15 134 1 125 5 b 115 33 119 18 117 24 b 0 330 91 145 49 252 b -10 355 -9 345 -10 348 b 13 381 -10 371 0 381 b 31 376 19 381 25 380 b 132 345 61 358 103 345 l 136 345 l 137 355 b 145 378 138 359 142 370 b 152 415 149 394 152 405 b 137 452 152 427 148 438 b 133 464 134 458 133 460 b 138 473 133 467 134 470 "},v53:{x_min:0,x_max:902.421875,ha:921,o:"m 17 240 b 24 241 19 241 21 241 b 32 240 28 241 31 241 b 46 229 38 238 43 234 b 50 88 50 223 50 237 b 50 -1 50 63 50 34 b 50 -90 50 -36 50 -65 b 46 -231 50 -238 50 -224 b 25 -242 42 -238 34 -242 b 0 -224 14 -242 4 -235 b 0 2 0 -222 0 -108 b 0 223 0 112 0 220 b 17 240 2 230 9 237 m 110 240 b 118 241 111 241 114 241 b 126 240 121 241 123 241 b 142 223 133 237 140 230 b 144 123 144 220 144 205 b 144 29 144 45 144 29 b 144 29 144 29 144 29 b 393 183 166 106 264 167 b 450 186 412 184 431 186 b 756 29 600 186 732 120 b 756 29 756 29 756 29 b 758 123 758 29 758 45 b 760 227 758 226 758 223 b 784 241 766 237 774 241 b 804 229 792 241 800 237 b 809 88 808 223 809 237 l 809 -1 l 809 -90 b 804 -231 809 -238 808 -224 b 784 -242 800 -238 792 -242 b 762 -231 775 -242 766 -238 b 758 -124 756 -224 758 -231 b 756 -30 758 -47 758 -30 b 756 -30 756 -30 756 -30 b 509 -184 736 -108 637 -169 b 450 -187 488 -187 469 -187 b 144 -30 300 -187 168 -122 b 144 -30 144 -30 144 -30 b 144 -124 144 -30 144 -47 b 140 -231 144 -231 144 -224 b 118 -242 134 -238 126 -242 b 92 -224 107 -242 96 -235 b 92 2 92 -222 92 -108 b 92 223 92 112 92 220 b 110 240 95 230 102 237 m 432 161 b 413 162 426 162 420 162 b 313 41 351 162 313 109 b 347 -73 313 5 323 -34 b 487 -163 385 -133 439 -163 b 578 -97 526 -163 562 -142 b 588 -43 585 -80 588 -62 b 432 161 588 47 518 147 m 868 240 b 876 241 869 241 872 241 b 884 240 879 241 882 241 b 898 229 890 238 894 234 b 902 88 902 223 902 237 l 902 -1 l 902 -90 b 898 -231 902 -238 902 -224 b 876 -242 892 -238 884 -242 b 852 -224 865 -242 854 -235 b 850 2 850 -222 850 -108 b 852 223 850 112 850 220 b 868 240 853 230 860 237 "},v54:{x_min:-24.5,x_max:317.140625,ha:324,o:"m -24 -161 l -24 -5 l -20 -5 b 0 -24 -9 -5 -2 -12 b 171 -315 21 -124 84 -233 b 317 -660 268 -406 317 -531 b 187 -1014 317 -782 274 -909 b 161 -1034 172 -1034 171 -1034 b 141 -1013 149 -1034 141 -1025 b 152 -991 141 -1004 142 -1002 b 266 -682 228 -899 266 -788 b 174 -430 266 -588 236 -498 b -23 -317 136 -388 66 -348 b -24 -161 -23 -316 -24 -285 "},v55:{x_min:0,x_max:551.25,ha:563,o:"m 289 644 b 304 645 294 645 299 645 b 404 566 349 645 392 613 b 406 541 405 557 406 549 b 379 471 406 514 397 489 l 377 467 l 382 470 b 509 591 438 485 485 531 b 513 601 510 595 513 599 b 530 609 518 607 524 609 b 551 588 540 609 551 602 b 200 -605 551 584 204 -599 b 182 -616 197 -612 190 -616 b 163 -602 174 -616 166 -610 b 161 -598 161 -601 161 -601 b 217 -402 161 -589 170 -562 b 272 -213 247 -298 272 -213 b 272 -213 272 -213 272 -213 b 264 -219 272 -213 268 -216 b 140 -262 227 -247 182 -262 b 36 -226 102 -262 65 -249 b 0 -145 12 -206 0 -176 b 17 -84 0 -124 5 -104 b 103 -38 38 -54 70 -38 b 191 -91 137 -38 172 -56 b 205 -141 201 -106 205 -124 b 178 -212 205 -167 196 -194 l 175 -215 l 182 -213 b 307 -93 236 -198 284 -151 b 372 129 308 -88 372 127 b 372 129 372 129 372 129 b 364 122 372 129 368 126 b 240 80 328 94 283 80 b 137 115 202 80 166 91 b 99 195 112 136 99 165 b 118 256 99 217 106 238 b 204 303 138 287 171 303 b 292 249 238 303 273 285 b 306 199 302 234 306 217 b 279 129 306 173 296 148 l 276 126 l 281 127 b 408 248 336 142 385 190 b 473 470 409 254 473 469 b 473 470 473 470 473 470 b 465 464 473 470 469 467 b 341 421 428 435 383 421 b 236 458 303 421 266 433 b 200 537 212 478 200 508 b 289 644 200 585 234 635 "},v58:{x_min:-21.78125,x_max:367.5,ha:375,o:"m 259 1553 b 265 1553 261 1553 264 1553 b 288 1540 272 1553 277 1550 b 367 1351 340 1493 367 1424 b 336 1221 367 1308 357 1263 l 332 1211 l 333 1208 b 367 1077 356 1170 367 1124 b 336 945 367 1032 357 986 l 332 935 l 333 932 b 367 800 356 893 367 848 b 336 669 367 756 357 710 l 332 659 l 333 656 b 367 523 356 617 367 571 b 345 412 367 485 360 446 b 231 273 322 356 284 310 b -1 19 121 195 27 93 b -17 4 -4 11 -10 5 l -21 4 l -21 134 l -21 265 l -17 265 b 133 291 20 265 96 278 b 318 537 245 328 318 433 b 307 603 318 559 315 582 b 303 614 304 612 304 614 b 298 609 302 614 300 613 b 231 549 281 589 258 567 b -1 295 121 471 27 369 b -17 280 -4 287 -10 281 l -21 280 l -21 410 l -21 541 l -17 541 b 133 567 20 541 96 555 b 318 813 245 605 318 709 b 307 880 318 835 315 859 b 303 891 304 888 304 891 b 298 885 302 891 300 888 b 231 825 281 866 258 843 b -1 571 121 748 27 645 b -17 556 -4 563 -10 557 l -21 556 l -21 687 l -21 817 l -17 817 b 133 843 20 817 96 830 b 318 1089 245 881 318 985 b 307 1156 318 1111 315 1134 b 303 1167 304 1164 304 1167 b 298 1161 302 1167 300 1164 b 231 1102 281 1140 258 1120 b -1 848 121 1024 27 921 b -17 832 -4 839 -10 834 l -21 832 l -21 963 l -21 1093 l -17 1093 b 114 1113 12 1093 78 1103 b 313 1314 215 1142 289 1218 b 318 1364 317 1331 318 1347 b 255 1511 318 1422 295 1478 b 243 1532 247 1519 243 1525 b 259 1553 243 1540 250 1550 "},v59:{x_min:0,x_max:464.140625,ha:474,o:"m 0 0 l 0 347 l 76 347 l 153 347 l 153 0 l 153 -348 l 76 -348 l 0 -348 l 0 0 m 308 -1 l 308 347 l 386 347 l 464 347 l 464 -1 l 464 -348 l 386 -348 l 308 -348 l 308 -1 "},v5a:{x_min:-171.5,x_max:170.140625,ha:174,o:"m -6 566 b 0 567 -5 567 -2 567 b 14 556 6 567 12 563 b 92 285 14 555 50 433 b 170 13 166 33 170 19 b 168 13 170 13 170 13 b 161 1 168 8 167 4 l 159 0 l 122 0 l 84 0 l 81 1 b 21 195 76 5 78 -5 b -32 381 -8 297 -32 381 b -87 197 -32 381 -57 298 b -141 8 -115 94 -140 9 b -155 0 -142 2 -149 0 b -171 15 -163 0 -171 5 b -14 556 -171 18 -24 528 b -6 566 -14 560 -10 564 "},v5b:{x_min:-441,x_max:439.640625,ha:449,o:"m -428 -2 b -421 0 -427 -1 -424 0 b -406 -6 -416 0 -409 -2 b -400 -31 -401 -12 -400 -15 b -1 -352 -392 -215 -215 -352 b 58 -349 19 -352 38 -351 b 398 -31 250 -326 392 -192 b 404 -6 398 -15 400 -12 b 419 -1 408 -2 413 -1 b 439 -13 427 -1 435 -5 b 439 -29 439 -16 439 -22 b 434 -105 439 -48 438 -80 b 0 -489 397 -333 213 -489 b -68 -484 -23 -489 -44 -488 b -441 -36 -280 -452 -436 -263 b -441 -30 -441 -34 -441 -31 b -428 -2 -441 -11 -439 -5 m -13 -9 b -1 -8 -9 -8 -5 -8 b 50 -36 19 -8 39 -19 b 61 -72 57 -47 61 -59 b 50 -106 61 -84 57 -97 b -1 -134 39 -124 19 -134 b -46 -115 -17 -134 -34 -129 b -62 -72 -57 -102 -62 -87 b -13 -9 -62 -44 -44 -16 "},v5c:{x_min:0,x_max:447.8125,ha:457,o:"m 0 -87 l 0 0 l 223 0 l 447 0 l 447 -87 l 447 -174 l 223 -174 l 0 -174 l 0 -87 "},v5d:{x_min:-1.359375,x_max:592.078125,ha:604,o:"m 280 692 b 295 694 283 692 289 694 b 310 692 300 694 307 692 b 357 630 340 684 357 657 b 336 580 357 612 351 594 b 311 538 321 566 311 549 b 352 492 311 512 330 492 b 366 495 357 492 362 492 b 397 553 390 503 397 517 b 415 603 397 576 402 591 b 460 623 427 617 443 623 b 509 599 479 623 498 614 b 522 559 518 587 522 573 b 494 506 522 538 513 519 b 451 495 481 498 473 496 b 415 488 432 495 426 494 b 394 449 404 483 394 464 b 394 448 394 448 394 448 l 394 440 l 397 433 b 428 409 404 420 413 413 b 438 408 431 408 435 408 b 479 431 450 408 462 415 b 528 455 495 448 510 455 b 548 452 534 455 541 453 b 592 391 577 442 592 416 b 549 331 592 365 577 340 b 528 327 541 328 534 327 b 479 351 510 327 495 335 b 438 374 464 367 450 374 b 417 369 431 374 424 373 b 394 333 402 360 394 348 b 400 312 394 326 396 319 b 451 287 408 294 420 288 b 513 258 484 285 499 278 b 522 223 519 247 522 234 b 461 159 522 190 496 159 b 449 161 457 159 453 159 b 397 229 416 167 397 191 b 366 288 397 265 390 278 b 352 290 362 290 357 290 b 315 262 336 290 321 280 b 311 245 313 256 311 251 b 334 204 311 233 318 220 b 355 170 348 190 351 184 b 357 152 356 166 357 159 b 355 136 357 147 356 140 b 295 88 345 104 321 88 b 232 152 264 88 232 112 b 255 204 232 174 238 186 b 279 244 273 222 279 231 l 279 245 b 238 290 279 270 259 290 b 224 288 234 290 228 290 b 193 229 200 278 193 265 b 141 161 193 191 174 167 b 129 159 137 159 133 159 b 68 223 93 159 68 190 b 77 258 68 234 70 247 b 138 287 91 278 106 285 b 185 302 166 287 175 291 b 196 333 193 312 196 323 b 174 369 196 347 187 360 b 152 374 166 373 159 374 b 111 351 140 374 126 367 b 62 327 95 335 80 327 b 51 328 58 327 54 327 b -1 391 16 334 -1 363 b 53 455 -1 420 17 449 b 62 455 57 455 59 455 b 111 431 80 455 95 448 b 152 408 127 415 140 408 b 161 409 155 408 159 408 b 193 433 176 413 186 420 l 196 440 l 196 448 b 196 451 196 449 196 449 b 190 471 196 459 194 463 b 137 495 182 489 167 495 l 134 495 l 134 495 b 68 560 95 495 68 521 b 129 623 68 596 95 623 b 144 621 134 623 138 623 b 193 553 175 614 193 589 b 224 495 193 517 200 503 b 238 492 228 492 234 492 b 279 538 259 492 279 512 b 254 580 279 549 269 566 b 232 630 239 594 232 612 b 280 692 232 657 250 684 m 307 456 b 295 458 303 458 299 458 b 230 391 258 458 230 426 b 236 360 230 381 231 371 b 295 324 249 337 272 324 b 353 360 318 324 341 337 b 360 391 357 370 360 381 b 307 456 360 421 340 451 "},v60:{x_min:-590.71875,x_max:589.359375,ha:601,o:"m -367 173 b -362 174 -366 174 -364 174 b -351 173 -357 174 -353 173 b -262 86 -348 172 -328 151 b -176 0 -216 37 -176 0 b -107 84 -176 0 -145 37 b -31 174 -36 173 -38 172 b -25 174 -29 174 -28 174 b -16 173 -23 174 -19 173 b 72 86 -13 172 6 151 b 157 0 119 37 157 0 b 227 84 159 0 189 37 b 303 174 298 173 296 172 b 308 174 304 174 307 174 b 318 173 313 174 317 173 b 481 11 322 172 357 134 l 494 -1 l 522 34 b 560 76 553 72 555 74 b 567 77 563 77 564 77 b 589 56 579 77 589 68 b 586 48 589 54 588 51 b 411 -172 583 41 416 -166 b 397 -176 406 -174 401 -176 b 387 -174 393 -176 390 -176 b 299 -87 386 -173 366 -152 b 213 0 253 -38 213 0 b 144 -86 213 0 182 -38 b 68 -174 73 -174 74 -173 b 62 -176 66 -176 65 -176 b 53 -174 59 -176 55 -174 b -35 -87 50 -173 29 -152 b -121 0 -83 -38 -121 0 b -190 -86 -122 0 -152 -38 b -266 -174 -261 -174 -259 -173 b -272 -176 -268 -176 -270 -176 b -281 -174 -276 -176 -280 -174 b -371 -86 -284 -173 -304 -152 b -457 0 -417 -38 -457 0 l -457 0 b -477 -26 -457 0 -470 -16 b -548 -227 -524 -88 -548 -161 b -536 -303 -548 -254 -544 -280 b -533 -317 -534 -309 -533 -313 b -553 -338 -533 -330 -541 -338 b -577 -315 -566 -338 -571 -333 b -590 -227 -586 -287 -590 -258 b -518 -9 -590 -154 -564 -77 b -465 56 -509 2 -504 8 l -402 134 b -367 173 -375 169 -372 172 "},v62:{x_min:46.28125,x_max:669.671875,ha:563,o:"m 183 376 b 189 376 185 376 187 376 b 212 374 197 376 208 376 b 265 337 234 369 253 355 b 274 317 268 331 273 320 b 274 316 274 317 274 316 b 280 323 276 316 276 319 b 311 358 288 337 299 348 b 319 366 315 360 318 365 b 356 376 326 373 340 376 b 382 371 364 376 374 374 b 428 337 400 366 417 352 b 436 317 431 331 436 320 b 438 316 436 317 436 316 b 442 323 438 316 439 319 b 475 358 451 337 462 348 b 483 366 477 360 481 365 b 518 376 488 373 503 376 b 544 373 528 376 536 376 b 604 285 579 360 604 326 b 597 249 604 273 601 258 b 543 63 596 247 544 70 b 541 54 543 61 541 55 b 540 44 540 51 540 47 b 552 23 540 33 545 23 b 552 23 552 23 552 23 b 647 126 586 29 627 72 b 658 138 651 136 653 138 b 660 138 660 138 660 138 b 669 129 666 137 669 136 b 654 88 669 122 665 109 b 562 -12 631 43 602 9 l 549 -19 b 521 -27 540 -24 530 -27 b 447 30 490 -27 458 -4 b 443 58 445 38 443 48 b 450 93 443 72 446 84 b 504 278 453 97 504 272 b 507 288 506 283 506 287 b 509 298 507 292 509 295 b 491 326 509 310 502 320 b 487 327 490 327 488 327 b 479 324 484 327 483 326 b 441 270 462 316 443 288 b 435 249 441 265 436 254 b 398 127 434 248 419 195 b 362 4 379 61 362 5 b 328 -1 359 -1 362 -1 b 314 -1 323 -1 319 -1 b 302 -1 310 -1 306 -1 b 266 4 266 -1 269 -1 b 265 6 265 5 265 5 b 303 144 265 13 272 34 b 343 278 325 216 343 276 b 344 288 343 281 344 285 b 345 298 345 291 345 295 b 330 326 345 310 340 320 b 323 327 328 327 325 327 b 317 324 322 327 321 326 b 279 270 300 316 281 288 b 273 249 279 265 274 254 b 236 127 272 248 255 195 b 200 4 216 61 200 5 b 164 -1 197 -1 198 -1 b 151 -1 161 -1 156 -1 b 140 -1 147 -1 142 -1 b 103 4 104 -1 106 -1 b 103 6 103 5 103 5 b 141 144 103 13 108 34 b 181 278 161 216 179 276 b 182 288 181 281 181 285 b 183 298 182 291 183 295 b 168 324 183 310 178 320 b 160 327 166 326 163 327 b 141 320 156 327 151 324 b 69 230 112 305 85 272 b 57 215 65 217 62 215 b 55 215 57 215 55 215 b 46 224 49 215 46 217 b 59 260 46 231 50 242 b 151 363 81 306 112 341 b 161 369 155 365 160 367 b 183 376 166 371 174 374 "},v68:{x_min:-597.53125,x_max:596.171875,ha:608,o:"m -533 324 b -525 327 -530 326 -528 327 b -504 305 -514 327 -504 317 b -504 305 -504 305 -504 305 b -513 284 -504 299 -504 299 b -556 112 -541 226 -556 167 b -545 33 -556 84 -552 58 b -524 -20 -541 15 -532 -9 l -522 -23 l -491 15 l -413 111 b -355 174 -367 169 -363 174 b -351 174 -353 174 -352 174 b -254 86 -343 174 -348 179 b -168 -1 -208 37 -168 -1 b -100 84 -168 -1 -137 37 b -23 173 -28 173 -29 172 b -19 174 -21 174 -20 174 b -8 173 -14 174 -10 173 b 155 11 -5 172 43 123 l 166 -1 l 168 1 l 170 4 l 170 130 b 171 260 170 256 170 258 b 191 274 175 269 183 274 b 205 267 196 274 201 272 b 212 158 212 262 210 273 l 212 56 l 257 112 b 311 173 304 172 304 172 b 317 174 313 174 314 174 b 326 173 319 174 323 173 b 490 11 329 172 366 134 l 502 -1 l 530 34 b 568 76 560 72 563 74 b 575 77 570 77 573 77 b 596 56 586 77 596 68 b 594 48 596 54 596 51 b 417 -172 592 41 424 -166 b 405 -176 415 -174 409 -176 b 396 -174 401 -176 398 -176 b 307 -87 393 -173 372 -152 b 221 -1 259 -38 221 -1 b 216 -6 221 -1 219 -2 l 212 -12 l 212 -147 b 212 -210 212 -173 212 -194 b 205 -292 212 -297 210 -287 b 191 -299 201 -297 196 -299 b 172 -287 183 -299 175 -295 b 170 -174 171 -284 171 -284 l 170 -63 l 127 -117 b 73 -176 84 -170 80 -176 b 68 -176 72 -176 70 -176 b -27 -87 59 -174 65 -180 b -114 0 -74 -38 -112 0 b -182 -86 -114 0 -145 -38 b -258 -174 -253 -174 -253 -173 b -264 -176 -259 -176 -262 -176 b -274 -174 -268 -176 -272 -174 b -438 -11 -277 -173 -348 -102 l -449 0 l -479 -37 b -524 -80 -513 -80 -514 -80 l -524 -80 b -553 -52 -534 -80 -540 -74 b -597 109 -583 -8 -597 48 b -560 280 -597 165 -585 224 b -533 324 -548 310 -540 322 "},v6c:{x_min:-1.359375,x_max:193.28125,ha:197,o:"m 78 233 b 87 233 81 233 84 233 b 187 140 132 233 174 195 b 193 102 190 127 193 115 b 43 -113 193 22 136 -62 b 27 -119 36 -116 31 -119 b 19 -108 21 -119 19 -115 b 29 -97 19 -102 20 -101 b 102 13 73 -72 102 -27 b 92 51 102 26 98 40 l 91 54 l 84 54 b 8 104 53 54 21 74 b -1 142 1 116 -1 130 b 78 233 -1 187 31 227 "},v6d:{x_min:-590.71875,x_max:589.359375,ha:601,o:"m 544 335 b 553 337 548 337 551 337 b 575 313 563 337 570 330 b 589 226 583 285 589 256 b 517 8 589 152 563 76 b 464 -58 507 -4 503 -9 l 401 -136 b 362 -176 372 -172 370 -176 b 357 -176 360 -176 359 -176 b 261 -87 349 -174 355 -180 b 175 0 215 -38 175 0 b 106 -86 175 0 144 -38 b 29 -174 35 -174 36 -173 b 24 -176 28 -176 27 -176 b 14 -174 21 -176 17 -174 b -73 -87 12 -173 -8 -152 b -159 0 -121 -38 -159 0 b -228 -86 -160 0 -190 -38 b -304 -174 -299 -174 -298 -173 b -310 -176 -306 -176 -308 -176 b -319 -174 -314 -176 -318 -174 b -483 -12 -323 -173 -359 -137 l -495 0 l -524 -34 b -562 -77 -553 -73 -556 -76 b -568 -79 -564 -79 -566 -79 b -590 -58 -581 -79 -590 -69 b -588 -49 -590 -55 -589 -52 b -412 170 -585 -43 -417 165 b -398 174 -408 173 -402 174 b -389 173 -394 174 -392 174 b -300 86 -387 172 -366 151 b -215 -1 -254 37 -215 -1 b -145 84 -215 -1 -183 37 b -69 173 -74 173 -76 172 b -63 174 -68 174 -66 174 b -54 173 -61 174 -57 173 b 34 86 -51 172 -31 151 b 119 -1 81 37 119 -1 b 189 84 121 -1 151 37 b 265 173 259 173 258 172 b 270 174 266 174 269 174 b 280 173 274 174 279 173 b 370 84 283 172 303 151 b 455 -1 416 37 455 -1 l 455 -1 b 476 24 455 -1 469 15 b 547 226 522 87 547 159 b 534 302 547 252 543 278 b 532 317 533 308 532 313 b 544 335 532 326 536 333 "},v6f:{x_min:-80.3125,x_max:78.9375,ha:81,o:"m 63 191 b 69 192 65 192 66 192 b 77 188 72 192 76 191 b 78 183 78 187 78 186 b 74 158 78 179 77 172 l 66 115 b 9 -161 49 30 10 -158 b -10 -187 6 -172 -1 -181 b -34 -194 -17 -191 -25 -194 b -80 -147 -58 -194 -80 -174 b -80 -141 -80 -144 -80 -142 b 9 70 -80 -134 -73 -117 l 49 163 b 63 191 59 188 61 190 "},v70:{x_min:0,x_max:436.921875,ha:446,o:"m 213 190 b 217 191 215 191 216 191 b 231 184 223 191 228 188 b 249 154 240 167 246 159 b 419 18 292 91 348 45 b 436 -1 435 11 436 8 b 424 -16 436 -9 434 -13 b 308 -87 394 -26 340 -59 b 231 -186 276 -117 257 -142 b 219 -192 228 -191 225 -192 b 198 -174 209 -192 208 -191 b 47 -33 161 -113 110 -63 b 10 -16 34 -26 17 -19 b 0 -1 2 -13 0 -9 b 17 18 0 8 1 11 b 198 173 95 48 156 101 b 213 190 206 187 208 188 "},v72:{x_min:-423.3125,x_max:421.9375,ha:431,o:"m -262 197 b -247 197 -257 197 -253 197 b -118 162 -210 197 -163 184 b 40 45 -61 134 -13 98 b 277 -95 119 -33 200 -81 b 289 -97 281 -97 285 -97 b 378 0 332 -97 371 -55 b 378 11 378 4 378 6 b 302 83 378 55 345 83 b 242 66 283 83 262 77 b 208 56 231 59 219 56 b 148 120 175 56 148 81 b 201 186 148 151 164 172 b 261 198 220 194 240 198 b 420 45 341 198 411 136 b 421 22 421 37 421 29 b 245 -199 421 -93 338 -199 b 238 -198 243 -199 240 -199 b -44 -47 148 -194 50 -141 b -250 86 -114 22 -183 66 b -295 94 -270 91 -283 94 b -315 91 -302 94 -307 94 b -381 4 -356 81 -381 43 b -355 -56 -381 -18 -372 -40 b -298 -81 -338 -73 -319 -81 b -246 -68 -283 -81 -265 -77 b -212 -58 -234 -61 -223 -58 b -178 -69 -200 -58 -189 -62 b -151 -122 -160 -81 -151 -101 b -171 -167 -151 -138 -157 -155 b -239 -195 -185 -181 -213 -192 b -257 -197 -245 -197 -250 -197 b -423 -5 -352 -197 -423 -109 b -412 65 -423 16 -419 40 b -262 197 -389 137 -329 188 "},v74:{x_min:-206.890625,x_max:428.75,ha:438,o:"m 389 -351 b 394 -351 390 -351 393 -351 b 428 -385 413 -351 428 -367 b 428 -394 428 -388 428 -391 b 394 -428 426 -406 421 -410 l 332 -473 l 269 -516 l 205 -560 l 141 -603 l 77 -648 l 13 -692 l -50 -737 l -114 -780 l -145 -802 b -171 -813 -157 -810 -163 -813 b -175 -813 -172 -813 -174 -813 b -206 -777 -194 -811 -206 -795 b -202 -760 -206 -771 -205 -766 b -87 -675 -197 -752 -206 -757 l -34 -639 l 83 -557 l 145 -514 l 209 -470 l 272 -427 b 389 -351 375 -356 381 -352 "},v75:{x_min:-149.71875,x_max:148.359375,ha:151,o:"m -137 381 b -130 383 -134 383 -133 383 b -111 371 -122 383 -114 378 b -55 224 -110 370 -85 305 b 0 80 -25 145 -1 80 b 54 224 0 80 24 145 b 112 377 114 384 110 373 b 127 384 118 381 122 384 b 148 362 138 384 148 374 l 148 356 l 83 183 b 16 9 47 88 17 11 b -1 0 12 2 5 0 b -14 5 -5 0 -10 1 b -84 183 -19 9 -13 -6 l -149 356 l -149 362 b -137 381 -149 371 -145 378 "},v78:{x_min:0,x_max:193.28125,ha:197,o:"m 85 514 b 95 517 88 517 89 517 b 114 505 103 517 110 513 l 115 502 l 115 376 b 115 249 115 306 115 249 b 141 258 117 249 127 252 l 167 266 l 172 266 b 190 254 181 265 187 262 l 193 251 l 193 202 l 193 188 b 187 147 193 149 191 152 b 147 130 183 142 182 141 l 115 119 l 115 9 b 115 -99 115 -51 115 -99 b 141 -91 115 -99 127 -95 b 171 -81 166 -81 167 -81 l 171 -81 b 191 -94 181 -81 189 -87 b 193 -142 191 -97 193 -120 b 191 -195 193 -167 191 -194 b 125 -227 187 -205 187 -204 l 115 -230 l 115 -366 l 115 -503 l 114 -506 b 95 -519 110 -514 102 -519 b 74 -506 87 -519 78 -514 l 73 -503 l 73 -374 b 73 -245 73 -260 73 -245 b 73 -245 73 -245 73 -245 b 55 -252 72 -245 63 -249 l 32 -260 b 19 -263 27 -262 23 -263 b 4 -256 13 -263 8 -260 b 0 -215 0 -251 0 -254 b 0 -199 0 -210 0 -206 l 0 -152 l 1 -149 b 8 -140 2 -145 5 -141 b 42 -127 9 -140 24 -133 l 73 -116 l 73 -5 b 73 23 73 4 73 15 b 73 105 73 70 73 105 b 49 97 73 105 61 101 b 17 88 32 91 23 88 b 4 95 10 88 8 91 b 0 137 0 101 0 98 b 0 151 0 141 0 145 l 0 199 l 1 202 b 43 224 5 212 5 212 l 73 234 l 73 367 l 73 502 l 74 505 b 85 514 77 509 81 513 "},v79:{x_min:-1.359375,x_max:899.703125,ha:918,o:"m 307 349 b 332 351 315 351 323 351 b 443 340 367 351 408 347 b 741 47 607 306 720 195 b 744 0 743 31 744 16 b 660 -303 744 -90 713 -206 b 28 -755 534 -531 304 -695 b 14 -756 23 -755 19 -756 b -1 -741 4 -756 -1 -750 b 21 -720 -1 -731 1 -728 b 567 -56 337 -601 548 -344 b 568 -11 568 -41 568 -24 b 442 285 568 129 525 233 b 325 319 406 308 367 319 b 93 177 232 319 137 266 b 84 154 91 170 84 155 b 84 154 84 154 84 154 b 88 156 84 154 85 155 b 159 177 110 170 134 177 b 257 134 194 177 231 162 b 294 41 281 108 294 73 b 171 -97 294 -24 246 -90 b 156 -98 166 -97 161 -98 b 6 74 73 -98 6 -22 b 6 80 6 76 6 79 b 307 349 10 223 141 340 m 839 215 b 845 216 841 216 842 216 b 862 213 852 216 860 215 b 899 163 887 206 899 184 b 872 117 899 145 890 127 b 847 111 865 112 856 111 b 808 130 833 111 818 117 b 796 162 800 140 796 151 b 839 215 796 187 812 212 m 839 -112 b 845 -112 841 -112 842 -112 b 862 -115 852 -112 860 -113 b 899 -165 887 -122 899 -144 b 872 -210 899 -183 890 -201 b 847 -217 865 -215 856 -217 b 808 -198 833 -217 818 -210 b 796 -165 800 -188 796 -177 b 839 -112 796 -140 812 -116 "},v7c:{x_min:0,x_max:300.8125,ha:307,o:"m 49 505 b 53 506 50 505 51 506 b 70 496 58 506 62 503 b 81 485 73 492 78 488 l 96 473 l 111 459 l 122 449 l 134 438 l 182 396 l 255 330 b 292 291 292 298 292 298 l 292 290 l 292 284 l 283 270 b 209 36 234 197 209 113 b 288 -170 209 -44 235 -119 b 299 -184 295 -179 299 -181 b 300 -191 300 -187 300 -188 b 285 -206 300 -199 294 -206 b 280 -206 283 -206 281 -206 b 247 -201 270 -202 259 -201 b 176 -222 223 -201 197 -208 b 114 -340 136 -249 114 -292 b 172 -471 114 -384 134 -433 b 185 -492 182 -481 185 -487 b 181 -502 185 -496 183 -499 b 171 -508 176 -505 174 -508 b 152 -498 166 -508 160 -503 b 0 -284 65 -428 12 -352 b 0 -260 0 -278 0 -270 b 1 -238 0 -252 0 -242 b 148 -140 16 -177 73 -140 b 209 -148 167 -140 189 -142 b 215 -149 212 -148 215 -149 b 215 -149 215 -149 215 -149 l 215 -149 b 201 -136 215 -148 209 -142 l 157 -97 l 96 -41 b 17 34 21 24 17 29 b 17 37 17 36 17 36 b 17 38 17 37 17 38 b 25 56 17 44 17 44 b 110 298 81 131 110 219 b 46 474 110 367 88 431 b 38 491 40 480 38 487 b 49 505 38 498 42 502 "},v7d:{x_min:-1.359375,x_max:436.921875,ha:446,o:"m 213 205 b 217 205 215 205 216 205 b 234 194 224 205 234 199 b 236 187 234 194 235 190 l 245 167 l 261 129 l 270 106 b 355 -61 294 54 329 -13 b 420 -163 381 -105 402 -138 b 436 -188 435 -184 436 -184 b 436 -191 436 -190 436 -190 b 421 -206 436 -201 431 -206 l 421 -206 l 416 -206 l 405 -201 b 217 -158 347 -172 283 -158 b 31 -201 153 -158 88 -172 l 20 -206 l 14 -206 l 14 -206 b 0 -191 5 -206 0 -201 b -1 -188 0 -190 -1 -190 b 14 -163 -1 -186 0 -184 b 95 -34 36 -136 72 -77 b 166 106 119 8 148 68 l 175 129 l 183 148 l 200 188 b 213 205 205 199 208 202 "},v7f:{x_min:0,x_max:367.5,ha:375,o:"m 0 124 l 0 187 l 61 187 l 122 187 l 122 138 l 122 91 l 153 61 l 183 30 l 213 61 l 243 91 l 243 138 l 243 187 l 306 187 l 367 187 l 367 124 l 367 61 l 321 61 l 274 61 l 243 30 l 213 0 l 243 -31 l 274 -62 l 321 -62 l 367 -62 l 367 -124 l 367 -188 l 306 -188 l 243 -188 l 243 -140 l 243 -93 l 213 -62 l 183 -31 l 153 -62 l 122 -93 l 122 -140 l 122 -188 l 61 -188 l 0 -188 l 0 -124 l 0 -62 l 46 -62 l 92 -62 l 123 -31 l 153 0 l 123 30 l 92 61 l 46 61 l 0 61 l 0 124 "},v80:{x_min:29.9375,x_max:420.578125,ha:371,o:"m 115 345 b 221 347 117 345 166 347 b 411 345 306 347 409 345 b 420 330 416 342 420 335 b 415 319 420 326 419 321 b 178 118 397 303 179 118 b 178 117 178 118 178 117 b 181 117 178 117 178 117 b 189 117 182 117 185 117 b 193 117 190 117 191 117 b 247 98 215 117 232 111 b 296 75 266 83 280 76 b 302 75 299 75 300 75 b 322 91 311 75 315 79 b 322 91 322 91 322 91 b 322 91 322 91 322 91 b 319 91 322 91 321 91 b 313 90 318 90 315 90 b 283 107 300 90 288 97 b 277 126 279 114 277 121 b 319 167 277 149 295 167 b 319 167 319 167 319 167 b 362 118 347 167 362 147 b 355 82 362 108 359 96 b 311 33 349 65 340 55 b 224 1 284 12 253 1 b 194 5 213 1 204 2 b 168 18 183 8 178 11 b 110 36 151 30 130 36 b 57 15 88 36 68 29 b 47 11 54 12 51 11 b 31 20 40 11 34 13 b 29 26 31 22 29 25 b 68 66 29 36 39 45 b 285 250 73 71 281 248 b 285 250 285 250 285 250 b 231 252 285 252 261 252 b 137 250 190 252 141 250 b 93 227 122 248 110 241 b 78 220 88 222 83 220 b 66 227 74 220 70 222 b 63 234 65 229 63 231 b 85 291 63 241 69 252 b 115 345 108 342 108 344 "},v81:{x_min:0,x_max:428.75,ha:438,o:"m 262 186 b 273 186 266 186 272 186 b 274 186 273 186 274 186 b 285 186 274 186 280 186 b 428 48 375 181 428 122 b 386 -68 428 12 416 -29 b 155 -187 329 -145 236 -187 b 12 -111 92 -187 38 -162 b 0 -51 4 -91 0 -72 b 262 186 0 58 122 179 m 366 131 b 352 134 362 133 357 134 b 219 81 321 134 269 115 b 47 -111 126 23 50 -62 b 47 -112 47 -111 47 -112 b 77 -136 47 -129 58 -136 b 264 -45 118 -136 194 -101 b 382 109 336 12 382 76 b 366 131 382 120 377 129 "},v83:{x_min:-1.359375,x_max:847.96875,ha:865,o:"m 488 1499 b 495 1500 490 1500 492 1500 b 541 1465 507 1500 521 1490 b 679 1078 622 1372 679 1210 b 677 1050 679 1068 677 1060 b 477 642 668 893 604 764 l 443 609 l 431 596 l 431 592 l 438 562 l 449 508 l 460 458 b 481 355 475 390 481 355 b 481 355 481 355 481 355 b 490 356 481 355 485 355 b 528 358 495 356 511 358 b 558 356 540 358 552 356 b 839 95 699 338 808 237 b 847 22 845 72 847 47 b 631 -303 847 -113 766 -242 b 620 -309 623 -308 620 -309 l 620 -310 b 631 -359 620 -310 626 -333 l 646 -435 l 660 -496 b 672 -588 668 -535 672 -563 b 664 -653 672 -610 669 -630 b 383 -875 630 -792 509 -875 b 201 -810 321 -875 257 -855 b 129 -680 151 -768 129 -730 b 274 -530 129 -592 200 -530 b 351 -553 300 -530 326 -538 b 412 -669 393 -582 412 -626 b 287 -805 412 -735 366 -800 l 279 -805 l 285 -809 b 383 -830 318 -823 351 -830 b 586 -718 464 -830 540 -789 b 626 -584 612 -678 626 -631 b 619 -528 626 -566 623 -548 b 612 -495 619 -526 616 -510 b 577 -324 590 -387 577 -324 b 577 -324 577 -324 577 -324 b 568 -326 575 -324 571 -324 b 528 -334 558 -328 537 -333 b 465 -338 506 -337 485 -338 b 24 -11 269 -338 87 -206 b -1 145 8 41 -1 93 b 96 442 -1 249 32 351 b 322 714 166 541 236 626 l 352 745 l 345 782 l 332 843 l 315 921 b 303 984 310 950 304 978 b 295 1082 298 1017 295 1049 b 413 1426 295 1208 336 1329 b 488 1499 436 1456 477 1496 m 549 1301 b 541 1301 547 1301 544 1301 b 411 1207 500 1301 447 1263 b 355 1004 374 1152 355 1079 b 359 942 355 984 356 963 b 371 881 362 927 363 917 l 385 818 b 392 782 389 799 392 784 l 392 782 b 434 828 393 782 424 816 b 607 1165 534 941 594 1060 b 608 1193 608 1175 608 1183 b 597 1270 608 1224 604 1254 b 549 1301 589 1286 571 1299 m 398 528 b 393 555 396 542 393 553 b 392 555 393 555 393 555 b 317 470 390 555 347 505 b 190 298 266 408 212 334 b 127 70 148 227 127 148 b 155 -77 127 19 137 -30 b 468 -303 209 -216 333 -303 b 519 -299 484 -303 502 -302 b 568 -284 541 -295 568 -287 l 568 -284 b 563 -263 568 -284 566 -274 l 534 -120 l 511 -13 l 496 61 l 480 133 b 469 187 472 176 469 187 b 468 188 469 187 469 188 b 416 162 462 188 430 172 b 337 13 364 126 337 69 b 413 -124 337 -40 363 -93 b 428 -144 424 -131 428 -137 b 428 -149 428 -145 428 -148 b 409 -166 426 -161 419 -166 b 394 -162 405 -166 400 -165 b 240 77 302 -122 240 -27 l 240 77 b 430 342 240 197 315 301 l 436 344 l 426 394 l 398 528 m 548 194 b 526 195 540 195 532 195 b 519 195 524 195 521 195 l 514 195 l 518 177 l 539 79 l 552 15 l 566 -48 l 594 -187 l 605 -240 b 612 -266 609 -254 611 -266 b 612 -266 612 -266 612 -266 b 641 -248 613 -266 630 -256 b 744 -98 692 -212 730 -156 b 751 -40 749 -79 751 -59 b 548 194 751 76 665 181 "},v84:{x_min:25.859375,x_max:164.6875,ha:168,o:"m 34 369 b 40 370 35 370 38 370 b 59 353 49 370 50 367 b 164 40 122 254 155 158 b 164 0 164 33 164 16 b 164 -40 164 -16 164 -34 b 59 -353 155 -158 122 -254 b 40 -371 53 -366 47 -371 b 34 -370 38 -371 36 -370 b 25 -358 28 -367 25 -363 b 31 -337 25 -352 27 -347 b 92 0 72 -234 92 -117 b 31 335 92 116 72 233 b 25 356 27 345 25 352 b 34 369 25 363 28 366 "},v86:{x_min:-571.671875,x_max:570.3125,ha:582,o:"m -386 173 b -381 174 -385 174 -383 174 b -370 173 -377 174 -372 173 b -281 86 -367 172 -347 151 b -196 0 -235 37 -196 0 b -126 84 -196 0 -164 37 b -50 174 -55 173 -57 172 b -44 174 -49 174 -47 174 b -35 173 -42 174 -38 173 b 53 86 -32 172 -12 151 b 138 0 100 37 138 0 b 208 84 140 0 170 37 b 284 174 279 173 277 172 b 289 174 285 174 288 174 b 299 173 294 174 298 173 b 462 11 303 172 338 134 l 475 -1 l 503 34 b 541 76 534 72 536 74 b 548 77 544 77 545 77 b 570 56 560 77 570 68 b 567 48 570 54 568 51 b 392 -172 564 41 397 -166 b 378 -176 387 -174 382 -176 b 368 -174 374 -176 371 -176 b 280 -87 367 -173 345 -152 b 194 0 234 -38 194 0 b 125 -86 194 0 163 -38 b 49 -174 54 -174 55 -173 b 43 -176 47 -176 46 -176 b 34 -174 40 -176 36 -174 b -54 -87 31 -173 10 -152 b -140 0 -102 -38 -140 0 b -209 -86 -141 0 -171 -38 b -285 -174 -280 -174 -279 -173 b -291 -176 -287 -176 -289 -176 b -300 -174 -295 -176 -299 -174 b -464 -12 -304 -173 -340 -137 l -476 0 l -504 -34 b -543 -77 -534 -73 -537 -76 b -549 -79 -545 -79 -547 -79 b -571 -58 -562 -79 -571 -69 b -568 -49 -571 -55 -570 -52 b -392 172 -566 -43 -396 167 b -386 173 -390 172 -387 173 "},v8a:{x_min:-170.140625,x_max:168.78125,ha:172,o:"m -160 567 b -122 567 -159 567 -149 567 l -87 567 l -84 566 b -74 553 -78 563 -77 560 b -20 366 -73 551 -49 466 b 31 186 8 267 31 186 b 85 371 31 186 55 269 b 140 559 114 473 138 557 b 153 567 141 564 148 567 b 168 559 159 567 166 564 b 168 555 168 557 168 557 b 92 281 168 548 159 513 b 14 13 50 134 14 13 b 0 0 14 6 6 0 b -17 15 -8 0 -17 8 b -93 283 -17 15 -51 136 b -170 552 -166 533 -170 548 b -170 553 -170 552 -170 552 b -160 567 -170 560 -167 564 "},v8b:{x_min:0,x_max:319.859375,ha:326,o:"m 149 508 b 159 509 152 509 155 509 b 186 494 170 509 181 503 b 190 440 190 487 190 488 l 190 430 l 190 377 l 242 377 l 251 377 b 303 373 298 377 296 377 b 319 345 314 367 319 356 b 304 319 319 335 314 324 b 250 315 296 315 299 315 l 242 315 l 190 315 l 190 262 l 190 252 b 186 198 190 204 190 205 b 159 183 179 188 170 183 b 132 198 148 183 138 188 b 127 252 127 205 127 204 l 127 262 l 127 315 l 76 315 l 68 315 b 14 319 20 315 21 315 b 0 347 4 324 0 335 b 14 373 0 356 4 367 b 68 377 21 377 20 377 l 76 377 l 127 377 l 127 430 l 127 440 b 132 494 127 488 127 487 b 149 508 136 501 142 505 "},v8c:{x_min:-330.75,x_max:329.390625,ha:336,o:"m -133 483 b -117 484 -127 484 -122 484 b 31 373 -51 484 9 440 b 35 348 34 365 35 356 b -25 285 35 313 10 285 b -87 331 -55 285 -76 302 b -167 402 -100 376 -133 402 b -191 398 -175 402 -183 401 b -227 341 -215 388 -227 369 b -225 320 -227 334 -227 327 b -13 74 -209 230 -125 133 b 6 65 -4 70 5 66 l 9 63 l 10 65 b 117 231 12 68 40 112 l 189 341 l 242 424 b 268 460 262 456 264 458 b 283 464 273 463 277 464 b 308 438 296 464 308 453 l 308 437 b 287 396 308 430 308 428 l 95 98 l 59 43 l 58 41 l 65 37 b 253 -156 151 -8 217 -77 b 281 -285 272 -199 281 -244 b 148 -481 281 -381 231 -463 b 115 -485 137 -484 126 -485 b -32 -376 51 -485 -9 -442 b -36 -349 -35 -366 -36 -358 b 25 -287 -36 -315 -12 -287 b 85 -333 54 -287 74 -302 b 166 -403 99 -377 133 -403 b 190 -399 174 -403 182 -402 b 225 -342 215 -390 225 -370 b 224 -322 225 -335 225 -328 b 12 -76 208 -231 125 -134 b -8 -66 2 -72 -6 -68 l -10 -65 l -12 -66 b -118 -231 -13 -68 -42 -113 l -190 -342 l -243 -426 b -269 -462 -264 -458 -265 -458 b -284 -466 -274 -464 -279 -466 b -310 -440 -298 -466 -310 -455 l -310 -438 b -288 -398 -310 -430 -308 -430 l -96 -99 l -59 -44 l -59 -43 l -66 -38 b -281 284 -198 33 -281 158 l -281 284 b -133 483 -281 392 -220 474 m 254 177 b 266 179 258 177 262 179 b 319 149 287 179 307 167 b 329 115 326 140 329 127 b 319 79 329 102 326 90 b 268 51 307 61 287 51 b 221 72 250 51 234 58 b 205 115 210 84 205 99 b 254 177 205 142 223 170 m -281 -54 b -269 -52 -277 -52 -273 -52 b -223 -73 -253 -52 -235 -59 b -206 -116 -212 -84 -206 -101 b -216 -151 -206 -129 -209 -141 b -269 -179 -228 -170 -249 -179 b -314 -159 -285 -179 -302 -173 b -330 -116 -325 -147 -330 -131 b -281 -54 -330 -88 -313 -61 "},v8f:{x_min:-21.78125,x_max:362.0625,ha:369,o:"m 302 1031 b 308 1032 304 1032 307 1032 b 330 1016 318 1032 325 1027 b 362 867 351 970 362 920 b 340 738 362 824 353 780 l 336 727 l 340 717 b 362 591 355 677 362 634 b 257 323 362 496 325 401 b 204 272 243 306 227 290 b 20 56 129 206 66 133 b -1 18 12 44 0 22 b -19 4 -4 9 -12 4 l -21 4 l -21 140 l -21 276 l -12 277 b 167 333 61 288 127 309 b 319 598 262 388 319 491 b 311 664 319 620 317 642 l 310 673 l 304 664 b 204 548 279 620 250 587 b 20 333 129 483 66 409 b -1 292 12 320 0 298 b -19 280 -4 285 -12 280 l -21 280 l -21 416 l -21 552 l -12 553 b 167 609 61 564 127 585 b 319 874 264 666 319 770 b 294 992 319 914 311 954 b 288 1011 288 1004 288 1007 b 302 1031 288 1021 294 1028 "},v90:{x_min:-171.5,x_max:483.1875,ha:493,o:"m -8 631 b -1 632 -6 632 -4 632 b 19 620 8 632 16 628 b 20 495 20 616 20 616 b 20 373 20 427 20 373 b 115 410 20 373 63 390 l 210 448 l 210 531 b 212 620 210 614 210 616 b 231 632 215 628 223 632 b 246 627 236 632 242 631 b 251 541 251 620 251 628 l 251 463 l 315 489 b 387 514 368 509 381 514 b 393 513 390 514 392 514 b 406 494 402 510 406 502 b 397 476 406 487 404 480 b 323 446 396 474 363 462 l 251 417 l 251 283 l 251 148 l 254 151 b 370 199 291 183 332 199 b 415 191 385 199 400 197 b 483 84 458 176 483 134 b 461 0 483 58 476 29 b 332 -142 439 -40 411 -72 l 255 -215 b 231 -229 240 -229 239 -229 b 216 -223 224 -229 220 -227 b 210 -158 210 -217 210 -223 b 210 -120 210 -148 210 -136 l 210 -29 l 205 -34 b 100 -142 182 -65 159 -88 l 23 -215 b -1 -229 9 -229 6 -229 b -19 -217 -9 -229 -16 -224 l -20 -215 l -21 48 l -21 310 l -83 287 b -152 262 -133 266 -145 262 b -157 263 -153 262 -155 262 b -171 283 -166 266 -171 274 b -161 301 -171 290 -167 297 b -91 328 -160 302 -129 315 l -21 356 l -21 487 l -20 617 l -19 621 b -8 631 -17 626 -12 630 m 210 288 b 210 401 210 351 210 401 b 114 365 209 401 167 384 l 20 327 l 20 238 l 20 148 l 21 151 b 140 199 59 183 102 199 b 206 180 164 199 187 192 l 209 177 b 209 177 209 177 209 177 b 210 288 210 177 210 199 m 110 131 b 96 133 106 133 100 133 b 89 133 93 133 91 133 b 24 87 63 129 40 113 l 20 80 l 20 -37 l 20 -156 l 23 -152 b 144 81 96 -72 144 20 l 144 83 b 110 131 144 113 134 126 m 341 131 b 328 133 337 133 332 133 b 322 133 326 133 323 133 b 257 87 296 129 273 113 l 251 80 l 251 -37 l 251 -156 l 255 -152 b 375 81 328 -72 375 20 l 375 83 b 341 131 375 113 367 126 "},v92:{x_min:0,x_max:598.890625,ha:611,o:"m 62 181 b 77 183 66 183 72 183 b 91 181 83 183 88 183 b 202 131 100 180 106 177 l 299 87 l 394 131 b 517 183 499 181 502 183 b 519 183 517 183 518 183 b 598 104 567 183 598 144 b 577 49 598 84 592 65 b 518 15 567 38 563 37 b 484 0 499 6 484 0 b 518 -16 484 -1 499 -8 b 577 -51 563 -38 567 -40 b 598 -105 592 -66 598 -86 b 519 -184 598 -145 567 -184 b 517 -184 518 -184 517 -184 b 394 -133 502 -184 499 -183 l 299 -88 l 202 -133 b 81 -184 99 -183 95 -184 b 77 -184 80 -184 78 -184 b 0 -105 29 -184 0 -145 b 20 -51 0 -86 5 -66 b 80 -16 29 -40 34 -38 b 114 -1 98 -8 114 -1 b 80 15 114 0 98 6 b 20 49 34 37 29 38 b 0 104 6 65 0 84 b 62 181 0 140 23 174 m 88 134 b 74 136 85 134 80 136 b 68 134 72 136 69 136 b 46 104 54 130 46 117 b 55 81 46 95 49 88 b 149 34 59 76 53 80 b 224 -1 190 15 224 0 b 144 -38 224 -1 187 -18 b 54 -84 59 -79 58 -79 b 46 -105 49 -90 46 -98 b 76 -137 46 -122 58 -137 b 78 -137 77 -137 77 -137 b 194 -86 87 -137 76 -141 b 298 -36 250 -58 298 -36 b 298 -36 298 -36 298 -36 b 402 -84 299 -36 345 -58 b 518 -137 522 -141 510 -137 b 521 -137 519 -137 519 -137 b 551 -105 539 -137 551 -122 b 541 -83 551 -98 548 -90 b 447 -36 537 -77 544 -81 b 374 -1 406 -16 374 -1 b 447 34 374 0 406 15 b 541 81 544 80 537 76 b 551 104 548 88 551 97 b 521 136 551 120 539 136 b 518 136 519 136 519 136 b 517 136 518 136 517 136 l 517 136 b 402 83 511 136 511 136 b 298 34 345 56 299 34 b 298 34 298 34 298 34 b 194 84 298 34 250 56 b 88 134 137 111 89 133 "},v93:{x_min:0,x_max:438.28125,ha:447,o:"m 212 205 b 219 205 213 205 216 205 b 239 183 228 205 231 204 b 421 -163 298 40 363 -83 b 438 -191 434 -180 438 -186 b 436 -197 438 -192 438 -195 b 424 -206 434 -204 431 -206 b 406 -201 420 -206 415 -205 b 216 -156 347 -172 281 -156 b 23 -205 148 -156 80 -173 b 14 -206 20 -206 17 -206 b 0 -191 6 -206 0 -201 b 6 -176 0 -187 1 -183 b 202 192 63 -104 142 45 b 212 205 205 199 208 202 m 264 48 l 249 81 l 243 94 l 242 91 b 89 -126 208 36 137 -66 b 81 -138 85 -133 81 -138 b 81 -138 81 -138 81 -138 b 81 -138 81 -138 81 -138 b 95 -133 81 -138 87 -136 b 280 -94 156 -108 221 -94 b 334 -98 299 -94 317 -95 b 343 -99 338 -99 343 -99 b 343 -99 343 -99 343 -99 b 338 -94 343 -99 341 -97 b 264 48 318 -58 287 1 "},v94:{x_min:-149.71875,x_max:148.359375,ha:151,o:"m -9 215 b 0 217 -6 217 -4 217 b 19 205 8 217 14 213 b 20 142 20 202 20 201 l 20 84 l 23 84 b 144 -27 81 74 129 30 b 148 -66 147 -40 148 -54 b 36 -213 148 -134 103 -197 b 0 -219 24 -217 12 -219 b -145 -104 -68 -219 -129 -173 b -149 -68 -148 -91 -149 -79 b -24 84 -149 6 -98 74 l -21 84 l -21 142 b -19 205 -20 201 -20 202 b -9 215 -17 209 -13 213 m -21 -15 b -23 41 -21 37 -21 41 b -23 41 -23 41 -23 41 b -76 11 -35 40 -62 26 b -108 -65 -98 -11 -108 -38 b -1 -176 -108 -122 -65 -176 b 107 -65 63 -176 107 -122 b 74 11 107 -38 96 -11 b 20 41 61 26 32 41 b 20 -15 20 41 20 15 b 19 -74 20 -72 20 -72 b 0 -87 14 -83 6 -87 b -19 -74 -8 -87 -16 -83 b -21 -15 -20 -72 -20 -72 "},v95:{x_min:0,x_max:406.96875,ha:415,o:"m 55 181 b 70 183 61 183 66 183 b 111 170 85 183 99 179 b 160 130 115 167 137 149 l 202 95 l 245 130 b 319 181 299 176 302 179 b 334 183 325 183 330 183 b 406 109 375 183 406 148 b 401 81 406 99 405 91 b 348 24 394 65 390 59 b 318 -1 332 11 318 0 b 348 -26 318 -1 332 -12 b 401 -83 390 -61 394 -66 b 406 -111 405 -93 406 -101 b 334 -184 406 -149 375 -184 b 319 -183 330 -184 325 -184 b 245 -131 302 -180 299 -177 l 202 -97 l 160 -131 b 85 -183 107 -177 103 -180 b 70 -184 80 -184 76 -184 b 0 -111 31 -184 0 -149 b 4 -83 0 -101 1 -93 b 58 -26 10 -66 16 -61 b 88 -1 74 -12 88 -1 b 58 24 88 0 74 11 b 10 69 23 54 17 59 b 0 109 2 81 0 95 b 55 181 0 142 21 173 m 83 133 b 72 136 78 136 76 136 b 57 131 66 136 61 134 b 46 109 49 126 46 117 b 50 93 46 104 47 98 b 107 45 51 91 77 70 b 160 0 137 20 160 0 b 107 -47 160 -1 137 -22 b 50 -94 77 -72 51 -93 b 46 -111 47 -99 46 -105 b 59 -134 46 -120 50 -130 b 72 -137 62 -136 68 -137 b 83 -136 76 -137 80 -136 b 144 -84 84 -134 107 -116 b 202 -36 176 -58 202 -36 b 261 -84 202 -36 230 -58 b 323 -136 299 -116 321 -134 b 334 -137 326 -136 330 -137 b 345 -134 338 -137 343 -136 b 360 -111 355 -130 360 -120 b 355 -94 360 -105 359 -99 b 299 -47 353 -93 329 -72 b 245 0 269 -22 245 -1 b 299 45 245 0 269 20 b 355 93 329 70 353 91 b 360 109 359 98 360 104 b 345 133 360 119 355 129 b 334 136 343 134 338 136 b 323 134 330 136 326 134 b 261 83 321 133 299 115 b 202 34 230 56 202 34 b 144 83 202 34 176 56 b 83 133 106 115 84 133 "},v97:{x_min:-228.671875,x_max:227.3125,ha:232,o:"m -217 487 l -213 488 l 0 488 l 212 488 l 216 487 b 225 476 220 484 224 480 l 227 473 l 227 244 l 227 15 l 225 12 b 206 0 223 4 215 0 b 197 1 204 0 200 0 b 187 12 193 4 189 6 l 186 15 l 186 138 l 186 262 l -1 262 l -187 262 l -187 138 l -187 15 l -189 12 b -208 0 -193 4 -200 0 b -227 12 -216 0 -223 4 l -228 15 l -228 244 l -228 473 l -227 476 b -217 487 -225 480 -221 484 "},v9a:{x_min:-21.78125,x_max:367.5,ha:375,o:"m 230 1031 b 238 1032 232 1032 235 1032 b 259 1014 245 1032 251 1027 b 367 662 330 906 367 782 b 364 602 367 641 367 621 b 232 317 352 488 304 384 b 57 120 155 245 103 187 b -1 18 31 84 6 40 b -19 4 -4 11 -12 4 l -21 4 l -21 159 l -21 315 l -16 315 b 96 335 10 315 62 324 b 315 695 227 380 315 527 b 313 738 315 709 314 724 b 224 991 304 825 273 916 b 216 1013 219 999 216 1007 b 230 1031 216 1021 220 1028 "},v9b:{x_min:-24.5,x_max:313.0625,ha:319,o:"m -24 -133 l -24 -5 l -20 -5 b -1 -19 -12 -5 -4 -11 b 142 -213 13 -61 74 -144 b 258 -376 196 -269 230 -315 b 313 -605 295 -449 313 -528 b 292 -742 313 -652 306 -699 b 288 -752 289 -748 288 -752 b 288 -752 288 -752 288 -752 b 292 -764 289 -753 291 -757 b 313 -907 306 -811 313 -860 b 292 -1045 313 -954 306 -1002 b 288 -1054 289 -1050 288 -1054 b 288 -1054 288 -1054 288 -1054 b 292 -1067 289 -1054 291 -1060 b 313 -1210 306 -1113 313 -1161 b 292 -1346 313 -1257 306 -1304 b 288 -1357 289 -1353 288 -1357 b 288 -1357 288 -1357 288 -1357 b 292 -1368 289 -1357 291 -1363 b 313 -1512 306 -1415 313 -1464 b 292 -1648 313 -1560 306 -1605 b 288 -1660 289 -1654 288 -1660 b 288 -1660 288 -1660 288 -1660 b 292 -1671 289 -1660 291 -1665 b 313 -1814 306 -1719 313 -1766 b 250 -2040 313 -1897 291 -1977 b 232 -2062 238 -2057 236 -2059 b 221 -2065 230 -2063 225 -2065 b 200 -2045 210 -2065 201 -2057 b 200 -2043 200 -2044 200 -2044 b 208 -2026 200 -2037 202 -2034 b 269 -1826 249 -1966 269 -1897 b 153 -1544 269 -1726 230 -1625 b -9 -1472 115 -1506 58 -1481 b -21 -1471 -14 -1471 -19 -1471 l -24 -1471 l -24 -1343 l -24 -1215 l -20 -1215 b -1 -1229 -12 -1215 -4 -1221 b 142 -1424 13 -1270 74 -1353 b 257 -1582 196 -1478 228 -1524 b 264 -1594 261 -1589 264 -1594 l 264 -1594 b 265 -1582 264 -1594 264 -1589 b 270 -1525 268 -1562 270 -1544 b 153 -1243 270 -1424 228 -1321 b -9 -1170 115 -1203 58 -1178 b -21 -1168 -14 -1170 -19 -1168 l -24 -1168 l -24 -1041 l -24 -913 l -20 -913 b -1 -927 -12 -913 -4 -918 b 142 -1121 13 -967 74 -1050 b 257 -1281 196 -1175 228 -1221 b 264 -1292 261 -1286 264 -1292 l 264 -1292 b 265 -1279 264 -1292 264 -1286 b 270 -1222 268 -1261 270 -1242 b 153 -941 270 -1121 228 -1018 b -9 -867 115 -900 58 -875 b -21 -866 -14 -867 -19 -866 l -24 -866 l -24 -738 l -24 -610 l -20 -610 b -1 -624 -12 -610 -4 -616 b 142 -818 13 -664 74 -749 b 257 -978 196 -873 228 -918 b 264 -989 261 -984 264 -989 l 264 -989 b 265 -977 264 -989 264 -984 b 270 -920 268 -959 270 -939 b 153 -638 270 -818 228 -716 b -9 -564 115 -598 58 -573 b -21 -563 -14 -564 -19 -563 l -24 -563 l -24 -435 l -24 -308 l -20 -308 b -1 -322 -12 -308 -4 -313 b 142 -516 13 -363 74 -446 b 257 -675 196 -571 228 -616 b 264 -687 261 -681 264 -687 l 264 -687 b 265 -674 264 -687 264 -681 b 270 -617 268 -656 270 -637 b 153 -335 270 -516 228 -413 b -9 -262 115 -295 58 -270 b -21 -260 -14 -262 -19 -260 l -24 -260 l -24 -133 "},v9c:{x_min:-166.0625,x_max:-25.859375,ha:0,o:"m -49 369 b -42 370 -46 369 -44 370 b -27 360 -36 370 -29 366 b -25 355 -27 359 -25 358 b -32 335 -25 351 -28 347 b -92 52 -66 248 -87 159 b -93 -1 -93 43 -93 20 b -92 -54 -93 -23 -93 -45 b -32 -337 -85 -162 -66 -251 b -25 -355 -27 -349 -25 -352 b -42 -371 -25 -365 -32 -371 b -61 -353 -50 -371 -51 -369 b -163 -63 -119 -262 -153 -165 b -166 -1 -166 -37 -166 -31 b -163 62 -166 30 -166 36 b -61 352 -153 163 -119 260 b -49 369 -54 365 -51 366 "},v9e:{x_min:0,x_max:607.0625,ha:619,o:"m 243 631 b 250 632 246 632 249 632 b 270 620 259 632 268 628 l 272 616 l 272 201 l 272 -212 l 270 -216 b 251 -229 268 -224 259 -229 b 227 -215 243 -229 240 -229 l 151 -142 b 32 -16 81 -80 53 -49 b 0 84 9 18 0 52 b 111 199 0 149 42 199 b 137 197 119 199 127 198 b 228 151 168 191 197 177 l 231 148 l 231 383 b 232 620 231 616 231 616 b 243 631 234 624 238 630 m 168 131 b 152 133 163 133 157 133 b 107 102 130 133 111 120 b 106 86 107 97 106 91 b 111 41 106 73 108 56 b 227 -152 125 -13 171 -90 l 231 -156 l 231 -37 l 231 80 l 225 87 b 168 131 210 111 190 126 m 347 631 b 353 632 348 632 351 632 b 374 620 363 632 371 628 b 375 383 375 616 375 616 l 375 148 l 377 151 b 492 199 415 183 454 199 b 537 191 507 199 522 197 b 607 84 582 176 607 134 b 583 0 607 58 598 29 b 455 -142 562 -40 533 -72 l 378 -215 b 355 -229 364 -229 362 -229 b 334 -216 345 -229 337 -224 l 333 -212 l 333 201 l 333 616 l 334 620 b 347 631 337 624 341 630 m 465 131 b 451 133 461 133 455 133 b 445 133 449 133 446 133 b 379 87 419 129 396 113 l 375 80 l 375 -37 l 375 -156 l 378 -152 b 499 81 451 -72 499 20 l 499 83 b 465 131 499 113 490 126 "},va3:{x_min:58.53125,x_max:228.671875,ha:294,o:"m 138 371 b 142 373 140 371 141 373 b 178 342 149 373 156 366 b 228 251 217 297 228 278 b 228 244 228 248 228 247 b 176 147 227 212 212 184 b 123 73 152 122 132 93 b 121 62 122 70 121 66 b 145 13 121 48 129 31 b 153 -2 151 6 153 1 b 149 -9 153 -5 152 -6 b 144 -11 148 -11 145 -11 b 129 -1 140 -11 136 -8 b 61 87 89 37 68 68 b 58 113 59 95 58 105 b 110 215 58 144 74 177 b 163 287 134 240 155 269 b 166 299 166 291 166 295 b 141 348 166 313 157 330 b 133 360 134 356 133 358 b 133 363 133 362 133 362 b 138 371 133 367 136 370 "},va5:{x_min:0,x_max:349.8125,ha:357,o:"m 88 302 b 103 303 93 302 98 303 b 202 224 149 303 191 270 b 205 199 204 216 205 208 b 178 129 205 173 196 147 l 175 126 l 182 127 b 307 249 236 142 284 190 b 313 259 308 254 311 258 b 329 267 317 265 323 267 b 349 247 340 267 349 259 b 201 -263 349 242 204 -258 b 182 -273 197 -270 190 -273 b 163 -260 174 -273 166 -269 b 161 -256 161 -259 161 -258 b 217 -59 161 -248 170 -220 b 272 129 247 43 272 127 b 272 129 272 129 272 129 b 264 122 272 129 268 126 b 140 80 227 94 183 80 b 36 115 102 80 65 91 b 0 194 10 136 0 165 b 88 302 0 244 32 292 "},va9:{x_min:-24.5,x_max:314.421875,ha:321,o:"m -24 -145 l -24 -5 l -20 -5 b 0 -23 -9 -5 -2 -12 b 27 -87 4 -38 14 -66 b 138 -220 53 -136 88 -177 b 235 -328 179 -255 208 -288 b 314 -592 287 -409 314 -501 b 292 -732 314 -639 307 -687 l 289 -742 l 294 -756 b 314 -896 307 -802 314 -849 b 292 -1035 314 -943 307 -991 l 289 -1045 l 294 -1057 b 314 -1197 307 -1104 314 -1152 b 292 -1338 314 -1246 307 -1292 l 289 -1347 l 294 -1360 b 314 -1500 307 -1407 314 -1454 b 273 -1689 314 -1565 300 -1628 b 250 -1712 265 -1710 261 -1712 b 228 -1691 236 -1712 228 -1704 l 228 -1685 l 234 -1675 b 270 -1507 258 -1621 270 -1564 b 98 -1193 270 -1381 209 -1261 b 40 -1174 76 -1179 58 -1174 b -10 -1189 24 -1174 8 -1178 b -20 -1192 -14 -1192 -16 -1192 l -24 -1192 l -24 -1052 l -24 -913 l -20 -913 b 0 -931 -9 -913 -2 -920 b 27 -995 4 -946 14 -974 b 138 -1128 53 -1043 88 -1085 b 257 -1275 190 -1172 228 -1220 b 262 -1283 259 -1279 262 -1283 l 262 -1283 b 269 -1249 264 -1282 268 -1260 b 270 -1206 270 -1233 270 -1220 b 98 -891 270 -1075 206 -957 b 40 -871 76 -877 58 -871 b -10 -886 24 -871 8 -875 b -20 -889 -14 -889 -16 -889 l -24 -889 l -24 -749 l -24 -610 l -20 -610 b 0 -628 -9 -610 -2 -617 b 27 -692 4 -644 14 -671 b 138 -825 53 -741 88 -782 b 257 -973 190 -870 228 -917 b 262 -981 259 -977 262 -981 l 262 -981 b 269 -946 264 -979 268 -957 b 270 -903 270 -931 270 -917 b 98 -588 270 -774 206 -655 b 40 -569 76 -574 58 -569 b -10 -584 24 -569 8 -574 b -20 -587 -14 -587 -16 -587 l -24 -587 l -24 -448 l -24 -308 l -20 -308 b 0 -326 -9 -308 -2 -315 b 27 -390 4 -341 14 -369 b 138 -523 53 -438 88 -480 b 257 -670 190 -567 228 -614 b 262 -678 259 -674 262 -678 b 262 -678 262 -678 262 -678 b 269 -644 264 -677 268 -656 b 270 -601 270 -628 270 -614 b 98 -285 270 -471 206 -352 b 40 -266 76 -273 58 -266 b -10 -281 24 -266 8 -272 b -20 -284 -14 -284 -16 -284 l -24 -284 l -24 -145 "},vaa:{x_min:-1.359375,x_max:752.703125,ha:768,o:"m 490 985 b 504 986 495 986 500 986 b 604 907 551 986 593 954 b 607 884 607 900 607 892 b 581 813 607 857 597 831 l 578 810 l 583 811 b 710 932 638 827 687 873 b 714 943 711 936 713 942 b 730 952 720 949 725 952 b 752 931 741 952 752 943 b 200 -946 752 927 204 -941 b 182 -957 197 -953 190 -957 b 163 -945 174 -957 166 -953 b 161 -939 161 -942 161 -942 b 217 -743 161 -931 170 -904 b 272 -555 247 -639 272 -555 b 272 -555 272 -555 272 -555 b 264 -560 272 -555 268 -557 b 140 -603 227 -589 182 -603 b 36 -567 102 -603 65 -592 b -1 -487 12 -548 -1 -517 b 17 -427 -1 -466 5 -445 b 103 -380 38 -395 70 -380 b 191 -433 137 -380 172 -398 b 205 -484 201 -448 205 -466 b 178 -553 205 -509 196 -535 l 175 -557 l 182 -555 b 307 -435 236 -539 284 -494 b 372 -213 308 -430 372 -215 b 372 -213 372 -213 372 -213 b 364 -219 372 -213 368 -216 b 240 -262 328 -247 283 -262 b 137 -226 202 -262 166 -249 b 99 -145 112 -206 99 -176 b 118 -84 99 -124 106 -104 b 204 -38 138 -54 171 -38 b 292 -91 238 -38 273 -56 b 306 -141 302 -106 306 -124 b 279 -212 306 -167 296 -194 l 276 -215 l 281 -213 b 408 -93 336 -198 385 -151 b 473 129 409 -88 473 127 b 473 129 473 129 473 129 b 465 122 473 129 469 126 b 341 80 428 94 383 80 b 236 115 303 80 266 91 b 200 195 213 136 200 165 b 217 256 200 217 206 238 b 304 303 239 287 272 303 b 393 249 338 303 374 285 b 406 199 402 234 406 217 b 379 129 406 173 397 148 l 377 126 l 382 127 b 509 248 436 142 485 190 b 574 470 510 254 574 469 b 574 470 574 470 574 470 b 566 464 574 470 570 467 b 442 421 529 435 484 421 b 337 458 404 421 367 433 b 300 538 314 477 300 508 b 318 598 300 559 306 580 b 404 645 340 630 372 645 b 494 592 439 645 475 627 b 507 541 502 577 507 559 b 480 471 507 516 498 489 l 477 467 l 483 470 b 608 589 537 485 586 531 b 675 811 611 595 675 810 b 675 811 675 811 675 811 b 666 806 675 811 671 809 b 543 763 628 777 585 763 b 438 799 504 763 468 775 b 401 878 412 820 401 849 b 490 985 401 928 434 977 "},vab:{x_min:0,x_max:272.21875,ha:278,o:"m 243 631 b 250 632 246 632 249 632 b 270 620 259 632 268 628 l 272 616 l 272 201 l 272 -212 l 270 -216 b 251 -229 268 -224 259 -229 b 227 -215 243 -229 240 -229 l 151 -142 b 32 -16 81 -80 53 -49 b 0 84 9 18 0 52 b 111 199 0 149 42 199 b 137 197 119 199 127 198 b 228 151 168 191 197 177 l 231 148 l 231 383 b 232 620 231 616 231 616 b 243 631 234 624 238 630 m 168 131 b 152 133 163 133 157 133 b 107 102 130 133 111 120 b 106 86 107 97 106 91 b 111 41 106 73 108 56 b 227 -152 125 -13 171 -90 l 231 -156 l 231 -37 l 231 80 l 225 87 b 168 131 210 111 190 126 "},vad:{x_min:0,x_max:873.828125,ha:892,o:"m 0 0 l 0 703 l 81 703 l 164 703 l 164 0 l 164 -705 l 81 -705 l 0 -705 l 0 0 m 225 0 l 225 703 l 246 703 l 268 703 l 268 366 l 268 30 l 274 36 b 314 79 284 44 302 63 b 413 302 357 137 392 213 b 432 327 419 324 421 327 b 449 306 443 327 447 322 b 611 115 457 195 529 115 b 651 122 624 115 638 117 b 728 316 705 140 724 188 b 729 388 728 342 729 366 b 671 635 729 533 711 602 b 581 662 649 652 616 662 b 477 637 545 662 510 653 l 475 635 l 477 634 b 503 627 488 632 495 631 b 545 556 532 612 545 584 b 491 480 545 524 526 491 b 465 474 481 476 473 474 b 379 563 417 474 379 516 b 389 602 379 576 382 588 b 541 691 409 641 479 681 b 582 694 555 692 568 694 b 865 462 714 694 834 598 b 873 392 871 440 873 416 b 865 317 873 367 871 341 b 639 84 839 194 748 101 b 612 83 630 83 620 83 b 511 116 577 83 543 94 b 504 120 509 119 506 120 b 504 120 504 120 504 120 b 469 59 504 120 488 93 l 432 -1 l 469 -61 b 504 -122 488 -94 504 -122 b 504 -122 504 -122 504 -122 b 511 -117 506 -122 509 -120 b 612 -84 543 -95 577 -84 b 665 -91 630 -84 647 -87 b 869 -338 771 -122 850 -216 b 873 -392 872 -356 873 -374 b 798 -595 873 -469 847 -539 b 581 -695 741 -662 660 -695 b 406 -626 517 -695 454 -671 b 381 -563 389 -607 381 -585 b 465 -477 381 -519 413 -477 b 545 -559 514 -477 545 -519 b 503 -628 545 -587 532 -613 b 477 -635 495 -632 488 -634 l 475 -637 l 477 -638 b 581 -663 510 -655 545 -663 b 671 -637 616 -663 649 -653 b 729 -391 711 -603 729 -534 b 728 -317 729 -367 728 -344 b 623 -117 722 -173 698 -124 b 611 -116 619 -116 615 -116 b 449 -308 528 -116 457 -198 b 432 -328 447 -323 443 -328 b 413 -303 421 -328 419 -326 b 314 -80 392 -215 357 -138 b 274 -37 302 -65 284 -45 l 268 -31 l 268 -367 l 268 -705 l 246 -705 l 225 -705 l 225 0 "},vb1:{x_min:78.9375,x_max:485.921875,ha:417,o:"m 362 378 b 378 380 367 380 372 380 b 472 348 415 380 453 367 b 485 315 481 338 485 327 b 462 273 485 298 477 281 b 439 267 454 269 446 267 b 398 290 424 267 409 274 b 344 319 385 309 364 319 b 281 269 315 319 289 301 b 279 262 280 266 279 262 b 276 256 279 260 277 258 b 274 249 276 254 274 251 b 238 127 273 248 257 192 b 201 4 217 61 201 5 b 166 -1 198 -1 200 -1 b 153 -1 163 -1 157 -1 b 141 -1 148 -1 144 -1 b 104 4 106 -1 107 -1 b 104 6 104 5 104 5 b 142 144 104 13 110 34 b 182 278 164 219 181 276 b 183 288 182 281 182 285 b 185 302 185 292 185 298 b 164 330 185 317 176 328 b 159 330 163 330 161 330 b 102 302 140 330 119 320 b 91 294 95 295 93 294 b 88 294 91 294 89 294 b 78 303 83 294 78 298 b 81 312 78 306 78 309 b 200 373 106 347 160 373 b 215 371 205 373 209 371 b 266 335 235 367 254 353 b 269 331 268 333 269 331 b 269 331 269 331 269 331 b 273 335 269 331 270 334 b 362 378 298 359 330 376 "},vb3:{x_min:0,x_max:227.3125,ha:232,o:"m 91 213 b 100 215 93 215 96 215 b 227 58 167 215 224 144 b 227 52 227 56 227 54 b 61 -201 227 -43 164 -138 b 29 -216 44 -212 36 -216 b 23 -210 27 -216 24 -213 b 21 -205 21 -208 21 -206 b 34 -192 21 -201 25 -197 b 122 -55 89 -161 122 -106 b 104 6 122 -33 117 -12 l 103 9 l 96 9 b 4 79 57 9 17 38 b 0 112 1 90 0 101 b 91 213 0 163 36 209 "},vb4:{x_min:-597.53125,x_max:596.171875,ha:608,o:"m -533 324 b -525 327 -530 326 -528 327 b -504 305 -514 327 -504 317 b -504 305 -504 305 -504 305 b -513 284 -504 299 -504 299 b -556 112 -541 226 -556 167 b -545 33 -556 84 -552 58 b -524 -20 -541 15 -532 -9 l -522 -23 l -491 15 l -413 111 b -355 174 -367 169 -363 174 b -351 174 -353 174 -352 174 b -254 86 -343 174 -348 179 b -168 -1 -208 37 -168 -1 b -100 84 -168 -1 -137 37 b -23 173 -28 173 -29 172 b -19 174 -21 174 -20 174 b -8 173 -14 174 -10 173 b 80 86 -5 172 13 151 b 166 -1 127 37 166 -1 b 235 84 166 -1 197 37 b 311 173 306 173 304 172 b 317 174 313 174 314 174 b 326 173 319 174 323 173 b 490 11 329 172 366 134 l 502 -1 l 530 34 b 568 76 560 72 563 74 b 575 77 570 77 573 77 b 596 56 586 77 596 68 b 594 48 596 54 596 51 b 417 -172 592 41 424 -166 b 405 -176 415 -174 409 -176 b 396 -174 401 -176 398 -176 b 307 -87 393 -173 372 -152 b 221 -1 259 -38 221 -1 b 152 -86 221 -1 190 -38 b 76 -176 81 -174 83 -173 b 70 -176 74 -176 73 -176 b 61 -174 66 -176 62 -174 b -27 -87 58 -173 38 -152 b -114 -1 -74 -38 -112 -1 b -182 -86 -114 -1 -145 -38 b -258 -176 -253 -174 -253 -173 b -264 -176 -259 -176 -262 -176 b -274 -174 -268 -176 -272 -174 b -438 -11 -277 -173 -348 -102 l -449 0 l -479 -37 b -524 -80 -513 -80 -514 -80 l -524 -80 b -553 -52 -534 -80 -540 -74 b -597 109 -583 -8 -597 48 b -560 280 -597 165 -585 224 b -533 324 -548 310 -540 322 "},vb6:{x_min:0,x_max:556.6875,ha:568,o:"m 289 545 b 298 546 292 545 295 546 b 318 533 306 546 315 541 b 319 428 319 530 319 528 l 319 327 l 334 327 b 526 223 412 326 485 285 b 543 172 537 206 543 190 b 447 76 543 122 503 76 b 445 76 446 76 446 76 b 359 165 394 77 359 119 b 368 205 359 179 362 192 b 441 251 382 233 412 251 b 455 249 446 251 451 251 b 460 248 458 249 460 248 b 460 248 460 248 460 248 b 454 254 460 249 458 251 b 334 295 419 280 378 294 l 319 295 l 319 4 l 319 -287 l 321 -285 b 328 -285 322 -285 325 -285 b 524 -99 424 -277 507 -198 b 541 -79 526 -84 530 -79 b 556 -97 551 -79 556 -84 b 548 -133 556 -105 553 -117 b 334 -317 521 -233 434 -306 b 322 -319 329 -317 323 -317 l 319 -319 l 319 -424 b 319 -471 319 -444 319 -459 b 313 -541 319 -544 318 -535 b 298 -548 308 -545 303 -548 b 279 -534 289 -548 281 -542 b 277 -424 277 -531 277 -530 l 277 -317 l 273 -317 b 13 -95 153 -305 51 -217 b 0 2 4 -62 0 -29 b 182 295 0 126 66 238 b 274 324 210 309 249 320 l 277 324 l 277 427 b 279 533 277 528 277 530 b 289 545 281 538 285 542 m 277 2 b 277 291 277 161 277 291 b 268 288 277 291 273 290 b 144 1 179 265 144 184 b 276 -284 144 -199 175 -267 l 277 -285 l 277 2 "},vb9:{x_min:-122.5,x_max:121.140625,ha:124,o:"m -16 145 b 0 147 -10 147 -5 147 b 121 -1 66 147 121 77 b 114 -49 121 -16 118 -33 b -1 -148 95 -112 47 -148 b -85 -106 -31 -148 -61 -134 b -122 -1 -110 -76 -122 -38 b -16 145 -122 68 -81 134 m 12 111 b 0 113 8 113 4 113 b -68 22 -29 113 -61 73 b -70 0 -69 15 -70 6 b -13 -113 -70 -49 -47 -98 b -1 -115 -9 -115 -5 -115 b 63 -40 24 -115 53 -83 b 68 -1 66 -27 68 -15 b 12 111 68 48 46 97 "},vba:{x_min:-118.421875,x_max:597.53125,ha:381,o:"m 460 574 b 464 574 461 574 462 574 b 488 574 470 574 481 574 b 500 573 491 574 498 574 b 594 503 543 570 588 538 b 597 488 596 498 597 494 b 528 417 597 449 564 417 b 502 423 519 417 510 419 b 465 481 477 434 465 458 b 488 528 465 499 472 516 b 490 530 490 530 490 530 b 490 530 490 530 490 530 b 468 517 488 530 475 523 b 349 340 419 485 377 420 b 347 330 348 334 347 330 b 383 328 347 328 363 328 b 428 326 423 328 424 328 b 442 302 438 320 442 312 b 430 281 442 294 438 285 b 385 276 424 277 426 276 l 377 276 l 332 276 l 330 269 b 178 -117 303 126 250 -9 b 1 -249 129 -194 69 -237 b -20 -251 -6 -251 -13 -251 b -114 -187 -65 -251 -100 -227 b -118 -156 -117 -177 -118 -166 b -51 -84 -118 -116 -91 -84 b -31 -87 -46 -84 -39 -86 b 16 -152 0 -95 16 -124 b -12 -205 16 -173 8 -194 b -16 -208 -14 -206 -16 -208 b -14 -208 -16 -208 -14 -208 b -9 -206 -14 -208 -12 -208 b 74 -124 23 -197 54 -166 b 172 224 98 -79 125 22 b 185 276 178 252 183 274 b 185 276 185 276 185 276 b 141 276 185 276 181 276 b 91 280 96 276 96 276 b 77 302 83 285 77 294 b 91 326 77 312 83 320 b 148 328 95 328 96 328 l 198 330 l 202 341 b 460 574 249 473 351 566 "},vbf:{x_min:-53.078125,x_max:513.140625,ha:485,o:"m 185 383 b 196 384 187 383 191 384 b 277 334 230 384 259 365 b 288 301 281 324 288 306 b 288 297 288 298 288 297 b 294 302 289 297 291 299 b 394 370 323 338 367 367 b 404 371 398 370 401 371 b 510 272 453 371 498 328 b 513 237 513 262 513 251 b 507 172 513 217 511 192 b 326 -34 487 59 412 -26 b 314 -36 322 -36 318 -36 b 274 -24 298 -36 283 -31 l 265 -16 b 224 44 246 -1 232 20 b 223 49 224 47 223 49 b 223 49 223 49 223 49 b 149 -197 221 48 149 -194 b 149 -198 149 -197 149 -198 b 170 -210 149 -202 155 -205 b 187 -215 174 -210 175 -212 b 204 -231 201 -219 204 -222 b 197 -245 204 -240 202 -242 l 194 -248 l 76 -248 l -42 -248 l -46 -245 b -53 -231 -51 -242 -53 -240 b -35 -215 -53 -222 -49 -217 b -13 -210 -21 -212 -20 -212 b -6 -208 -10 -209 -8 -208 b 0 -206 -6 -208 -2 -206 b 25 -188 13 -201 21 -195 b 163 280 28 -183 163 276 b 166 291 163 283 164 287 b 167 302 167 295 167 299 b 155 324 167 315 161 324 b 155 324 155 324 155 324 b 65 230 125 322 85 280 b 53 215 61 217 58 215 b 51 215 53 215 51 215 b 42 224 46 215 42 217 b 57 263 42 231 47 244 b 140 360 77 305 104 337 b 152 370 144 365 149 369 b 185 383 157 376 172 381 m 374 306 b 366 308 371 308 368 308 b 300 273 348 308 321 294 b 284 254 288 262 287 259 b 280 242 283 249 281 245 b 257 169 279 240 270 213 l 236 98 l 236 93 b 251 48 238 77 243 61 b 279 27 258 37 272 27 b 281 27 279 27 280 27 b 291 31 281 27 287 30 b 396 170 334 52 378 109 b 406 247 402 197 406 224 b 401 277 406 259 405 270 b 374 306 397 290 383 303 "},vc3:{x_min:-10.890625,x_max:299.4375,ha:294,o:"m 136 460 b 142 462 137 462 140 462 b 166 449 152 462 161 456 b 171 428 168 446 168 445 b 288 131 194 322 238 209 b 298 115 295 120 296 117 b 299 106 298 112 299 109 b 273 81 299 91 287 81 b 255 86 268 81 261 83 b 155 116 225 104 183 116 l 152 116 l 149 108 b 141 83 148 102 144 91 b 134 48 137 69 134 58 b 149 9 134 34 140 24 b 153 -1 152 5 153 1 b 149 -9 153 -5 152 -6 b 144 -11 148 -11 147 -11 b 122 2 138 -11 133 -6 b 95 61 104 20 95 38 b 107 108 95 74 99 90 b 108 113 107 111 108 112 b 107 113 108 113 108 113 b 102 113 106 113 104 113 b 31 86 76 108 53 98 b 14 80 24 81 20 80 b -10 106 0 80 -10 91 b 0 131 -10 115 -9 116 b 115 430 49 209 91 317 b 136 460 119 451 123 456 "}},cssFontWeight:"normal",ascender:1903,underlinePosition:-125,cssFontStyle:"normal",boundingBox:{yMin:-2065.375,xMin:-695.53125,yMax:1901.578125,xMax:1159.671875},resolution:1e3,descender:-2066,familyName:"VexFlow-18",lineHeight:4093,underlineThickness:50};
Vex.Flow.renderGlyph=function(t,i,e,s,n,o){var h=72*s/(100*Vex.Flow.Font.resolution),r=Vex.Flow.Glyph.loadMetrics(Vex.Flow.Font,n,!o);Vex.Flow.Glyph.renderOutline(t,r.outline,h,i,e)},Vex.Flow.Glyph=function(){function t(t,i,e){this.code=t,this.point=i,this.context=null,this.options={cache:!0,font:Vex.Flow.Font},this.width=null,this.metrics=null,this.x_shift=0,this.y_shift=0,e?this.setOptions(e):this.reset()}return t.prototype={setOptions:function(t){Vex.Merge(this.options,t),this.reset()},setStave:function(t){return this.stave=t,this},setXShift:function(t){return this.x_shift=t,this},setYShift:function(t){return this.y_shift=t,this},setContext:function(t){return this.context=t,this},getContext:function(){return this.context},reset:function(){this.metrics=Vex.Flow.Glyph.loadMetrics(this.options.font,this.code,this.options.cache),this.scale=72*this.point/(100*this.options.font.resolution)},setWidth:function(t){return this.width=t,this},getMetrics:function(){if(!this.metrics)throw new Vex.RuntimeError("BadGlyph","Glyph "+this.code+" is not initialized.");return{x_min:this.metrics.x_min*this.scale,x_max:this.metrics.x_max*this.scale,width:this.width||(this.metrics.x_max-this.metrics.x_min)*this.scale,height:this.metrics.ha*this.scale}},render:function(i,e,s){if(!this.metrics)throw new Vex.RuntimeError("BadGlyph","Glyph "+this.code+" is not initialized.");var n=this.metrics.outline,o=this.scale;t.renderOutline(i,n,o,e,s)},renderToStave:function(i){if(!this.metrics)throw new Vex.RuntimeError("BadGlyph","Glyph "+this.code+" is not initialized.");if(!this.stave)throw new Vex.RuntimeError("GlyphError","No valid stave");if(!this.context)throw new Vex.RERR("GlyphError","No valid context");var e=this.metrics.outline,s=this.scale;t.renderOutline(this.context,e,s,i+this.x_shift,this.stave.getYForGlyphs()+this.y_shift)}},t.loadMetrics=function(t,i,e){var s=t.glyphs[i];if(!s)throw new Vex.RuntimeError("BadGlyph","Glyph "+i+" does not exist in font.");var n,o=s.x_min,h=s.x_max,r=s.ha;if(s.o)return e?s.cached_outline?n=s.cached_outline:(n=s.o.split(" "),s.cached_outline=n):(s.cached_outline&&delete s.cached_outline,n=s.o.split(" ")),{x_min:o,x_max:h,ha:r,outline:n};throw new Vex.RuntimeError("BadGlyph","Glyph "+this.code+" has no outline defined.")},t.renderOutline=function(t,i,e,s,n){var o=i.length;t.beginPath(),t.moveTo(s,n);for(var h=0;o>h;){var r=i[h++];switch(r){case"m":t.moveTo(s+i[h++]*e,n+i[h++]*-e);break;case"l":t.lineTo(s+i[h++]*e,n+i[h++]*-e);break;case"q":var l=s+i[h++]*e,c=n+i[h++]*-e;t.quadraticCurveTo(s+i[h++]*e,n+i[h++]*-e,l,c);break;case"b":var a=s+i[h++]*e,u=n+i[h++]*-e;t.bezierCurveTo(s+i[h++]*e,n+i[h++]*-e,s+i[h++]*e,n+i[h++]*-e,a,u)}}t.fill()},t}();Vex.Flow.Stave=function(){function t(t,i,e,n){arguments.length>0&&this.init(t,i,e,n)}var i=Vex.Flow.STAVE_LINE_THICKNESS>1?Vex.Flow.STAVE_LINE_THICKNESS:0;return t.prototype={init:function(t,i,e,n){this.x=t,this.y=i,this.width=e,this.glyph_start_x=t+5,this.glyph_end_x=t+e,this.start_x=this.glyph_start_x,this.end_x=this.glyph_end_x,this.context=null,this.glyphs=[],this.end_glyphs=[],this.modifiers=[],this.measure=0,this.clef="treble",this.font={family:"sans-serif",size:8,weight:""},this.options={vertical_bar_width:10,glyph_spacing_px:10,num_lines:5,fill_style:"#999999",spacing_between_lines_px:10,space_above_staff_ln:4,space_below_staff_ln:4,top_text_position:1},this.bounds={x:this.x,y:this.y,w:this.width,h:0},Vex.Merge(this.options,n),this.resetLines(),this.modifiers.push(new Vex.Flow.Barline(Vex.Flow.Barline.type.SINGLE,this.x)),this.modifiers.push(new Vex.Flow.Barline(Vex.Flow.Barline.type.SINGLE,this.x+this.width))},resetLines:function(){this.options.line_config=[];for(var t=0;t<this.options.num_lines;t++)this.options.line_config.push({visible:!0});this.height=(this.options.num_lines+this.options.space_above_staff_ln)*this.options.spacing_between_lines_px,this.options.bottom_text_position=this.options.num_lines+1},setNoteStartX:function(t){return this.start_x=t,this},getNoteStartX:function(){var t=this.start_x;return this.modifiers[0].barline==Vex.Flow.Barline.type.REPEAT_BEGIN&&this.modifiers.length>2&&(t+=20),t},getNoteEndX:function(){return this.end_x},getTieStartX:function(){return this.start_x},getTieEndX:function(){return this.x+this.width},setContext:function(t){return this.context=t,this},getContext:function(){return this.context},getX:function(){return this.x},getNumLines:function(){return this.options.num_lines},setNumLines:function(t){return this.options.num_lines=parseInt(t,10),this.resetLines(),this},setY:function(t){return this.y=t,this},setWidth:function(t){return this.width=t,this.glyph_end_x=this.x+t,this.end_x=this.glyph_end_x,this.modifiers[1].setX(this.end_x),this},getWidth:function(){return this.width},setMeasure:function(t){return this.measure=t,this},setBegBarType:function(t){return(t==Vex.Flow.Barline.type.SINGLE||t==Vex.Flow.Barline.type.REPEAT_BEGIN||t==Vex.Flow.Barline.type.NONE)&&(this.modifiers[0]=new Vex.Flow.Barline(t,this.x)),this},setEndBarType:function(t){return t!=Vex.Flow.Barline.type.REPEAT_BEGIN&&(this.modifiers[1]=new Vex.Flow.Barline(t,this.x+this.width)),this},getModifierXShift:function(t){"undefined"==typeof t&&(t=this.glyphs.length-1),"number"!=typeof t&&new Vex.RERR("InvalidIndex","Must be of number type");for(var i=this.glyph_start_x,e=0,n=0;t+1>n;++n){var s=this.glyphs[n];i+=s.getMetrics().width,e+=s.getMetrics().width}return e>0&&(e+=this.options.vertical_bar_width+10),e},setRepetitionTypeLeft:function(t,i){return this.modifiers.push(new Vex.Flow.Repetition(t,this.x,i)),this},setRepetitionTypeRight:function(t,i){return this.modifiers.push(new Vex.Flow.Repetition(t,this.x,i)),this},setVoltaType:function(t,i,e){return this.modifiers.push(new Vex.Flow.Volta(t,i,this.x,e)),this},setSection:function(t,i){return this.modifiers.push(new Vex.Flow.StaveSection(t,this.x,i)),this},setTempo:function(t,i){return this.modifiers.push(new Vex.Flow.StaveTempo(t,this.x,i)),this},setText:function(t,i,e){return this.modifiers.push(new Vex.Flow.StaveText(t,i,e)),this},getHeight:function(){return this.height},getSpacingBetweenLines:function(){return this.options.spacing_between_lines_px},getBoundingBox:function(){return new Vex.Flow.BoundingBox(this.x,this.y,this.width,this.getBottomY()-this.y)},getBottomY:function(){var t=this.options,i=t.spacing_between_lines_px,e=this.getYForLine(t.num_lines)+t.space_below_staff_ln*i;return e},getBottomLineY:function(){return this.getYForLine(this.options.num_lines)},getYForLine:function(t){var e=this.options,n=e.spacing_between_lines_px,s=e.space_above_staff_ln,o=this.y+(t*n+s*n)-i/2;return o},getYForTopText:function(t){var i=t||0;return this.getYForLine(-i-this.options.top_text_position)},getYForBottomText:function(t){var i=t||0;return this.getYForLine(this.options.bottom_text_position+i)},getYForNote:function(t){var i=this.options,e=i.spacing_between_lines_px,n=i.space_above_staff_ln,s=this.y+n*e+5*e-t*e;return s},getYForGlyphs:function(){return this.getYForLine(3)},addGlyph:function(t){return t.setStave(this),this.glyphs.push(t),this.start_x+=t.getMetrics().width,this},addEndGlyph:function(t){return t.setStave(this),this.end_glyphs.push(t),this.end_x-=t.getMetrics().width,this},addModifier:function(t){return this.modifiers.push(t),t.addToStave(this,0===this.glyphs.length),this},addEndModifier:function(t){return this.modifiers.push(t),t.addToStaveEnd(this,0===this.end_glyphs.length),this},addKeySignature:function(t){return this.addModifier(new Vex.Flow.KeySignature(t)),this},addClef:function(t,i,e){return this.clef=t,this.addModifier(new Vex.Flow.Clef(t,i,e)),this},addEndClef:function(t,i,e){return this.addEndModifier(new Vex.Flow.Clef(t,i,e)),this},addTimeSignature:function(t,i){return this.addModifier(new Vex.Flow.TimeSignature(t,i)),this},addEndTimeSignature:function(t,i){this.addEndModifier(new Vex.Flow.TimeSignature(t,i))},addTrebleGlyph:function(){return this.clef="treble",this.addGlyph(new Vex.Flow.Glyph("v83",40)),this},draw:function(){if(!this.context)throw new Vex.RERR("NoCanvasContext","Can't draw stave without canvas context.");for(var t,i,e=this.options.num_lines,n=this.width,s=this.x,o=0;e>o;o++)t=this.getYForLine(o),this.context.save(),this.context.setFillStyle(this.options.fill_style),this.context.setStrokeStyle(this.options.fill_style),this.options.line_config[o].visible&&this.context.fillRect(s,t,n,Vex.Flow.STAVE_LINE_THICKNESS),this.context.restore();s=this.glyph_start_x;for(var h=0;h<this.glyphs.length;++h)i=this.glyphs[h],i.getContext()||i.setContext(this.context),i.renderToStave(s),s+=i.getMetrics().width;for(s=this.glyph_end_x,h=0;h<this.end_glyphs.length;++h)i=this.end_glyphs[h],i.getContext()||i.setContext(this.context),s-=i.getMetrics().width,i.renderToStave(s);for(h=0;h<this.modifiers.length;h++)"function"==typeof this.modifiers[h].draw&&this.modifiers[h].draw(this,this.getModifierXShift());if(this.measure>0){this.context.save(),this.context.setFont(this.font.family,this.font.size,this.font.weight);var r=this.context.measureText(""+this.measure).width;t=this.getYForTopText(0)+3,this.context.fillText(""+this.measure,this.x-r/2,t),this.context.restore()}return this},drawVertical:function(t,i){this.drawVerticalFixed(this.x+t,i)},drawVerticalFixed:function(t,i){if(!this.context)throw new Vex.RERR("NoCanvasContext","Can't draw stave without canvas context.");var e=this.getYForLine(0),n=this.getYForLine(this.options.num_lines-1);i&&this.context.fillRect(t-3,e,1,n-e+1),this.context.fillRect(t,e,1,n-e+1)},drawVerticalBar:function(t){this.drawVerticalBarFixed(this.x+t,!1)},drawVerticalBarFixed:function(t){if(!this.context)throw new Vex.RERR("NoCanvasContext","Can't draw stave without canvas context.");var i=this.getYForLine(0),e=this.getYForLine(this.options.num_lines-1);this.context.fillRect(t,i,1,e-i+1)},getConfigForLines:function(){return this.options.line_config},setConfigForLine:function(t,i){if(t>=this.options.num_lines||0>t)throw new Vex.RERR("StaveConfigError","The line number must be within the range of the number of lines in the Stave.");if(!i.hasOwnProperty("visible"))throw new Vex.RERR("StaveConfigError","The line configuration object is missing the 'visible' property.");if("boolean"!=typeof i.visible)throw new Vex.RERR("StaveConfigError","The line configuration objects 'visible' property must be true or false.");return this.options.line_config[t]=i,this},setConfigForLines:function(t){if(t.length!==this.options.num_lines)throw new Vex.RERR("StaveConfigError","The length of the lines configuration array must match the number of lines in the Stave");for(var i in t)t[i]||(t[i]=this.options.line_config[i]),Vex.Merge(this.options.line_config[i],t[i]);return this.options.line_config=t,this}},t}();Vex.Flow.StaveConnector=function(){function t(t,e){this.init(t,e)}function e(e,i,s,h,o){if(i!==t.type.BOLD_DOUBLE_LEFT&&i!==t.type.BOLD_DOUBLE_RIGHT)throw Vex.RERR("InvalidConnector","A REPEAT_BEGIN or REPEAT_END type must be provided.");var n=3,_=3.5,r=2;i===t.type.BOLD_DOUBLE_RIGHT&&(n=-5,_=3),e.fillRect(s+n,h,1,o-h),e.fillRect(s-r,h,_,o-h)}return t.type={SINGLE_RIGHT:0,SINGLE_LEFT:1,SINGLE:1,DOUBLE:2,BRACE:3,BRACKET:4,BOLD_DOUBLE_LEFT:5,BOLD_DOUBLE_RIGHT:6,THIN_DOUBLE:7},t.prototype={init:function(e,i){this.thickness=Vex.Flow.STAVE_LINE_THICKNESS,this.width=3,this.top_stave=e,this.bottom_stave=i,this.type=t.type.DOUBLE,this.x_shift=0},setContext:function(t){return this.ctx=t,this},setType:function(e){return e>=t.type.SINGLE_RIGHT&&e<=t.type.THIN_DOUBLE&&(this.type=e),this},setText:function(t,e){return this.text=t,this.text_options={shift_x:0,shift_y:0},Vex.Merge(this.text_options,e),this.font={family:"times",size:16,weight:"normal"},this},setFont:function(t){Vex.Merge(this.font,t)},setXShift:function(t){if("number"!=typeof t)throw Vex.RERR("InvalidType","x_shift must be a Number");return this.x_shift=t,this},draw:function(){if(!this.ctx)throw new Vex.RERR("NoContext","Can't draw without a context.");var i=this.top_stave.getYForLine(0),s=this.bottom_stave.getYForLine(this.bottom_stave.getNumLines()-1)+this.thickness,h=this.width,o=this.top_stave.getX(),n=this.type===t.type.SINGLE_RIGHT||this.type===t.type.BOLD_DOUBLE_RIGHT||this.type===t.type.THIN_DOUBLE;n&&(o=this.top_stave.getX()+this.top_stave.width);var _=s-i;switch(this.type){case t.type.SINGLE:h=1;break;case t.type.SINGLE_LEFT:h=1;break;case t.type.SINGLE_RIGHT:h=1;break;case t.type.DOUBLE:o-=this.width+2;break;case t.type.BRACE:h=12;var r=this.top_stave.getX()-2,p=i,c=r,x=s,E=r-h,a=p+_/2,L=E-.9*h,y=p+.2*_,f=r+1.1*h,T=a-.135*_,B=f,v=a+.135*_,R=L,D=x-.2*_,I=E-h,O=D,u=r+.4*h,l=a+.135*_,b=u,G=a-.135*_,w=I,N=y;this.ctx.beginPath(),this.ctx.moveTo(r,p),this.ctx.bezierCurveTo(L,y,f,T,E,a),this.ctx.bezierCurveTo(B,v,R,D,c,x),this.ctx.bezierCurveTo(I,O,u,l,E,a),this.ctx.bezierCurveTo(b,G,w,N,r,p),this.ctx.fill(),this.ctx.stroke();break;case t.type.BRACKET:i-=4,s+=4,_=s-i,Vex.Flow.renderGlyph(this.ctx,o-5,i-3,40,"v1b",!0),Vex.Flow.renderGlyph(this.ctx,o-5,s+3,40,"v10",!0),o-=this.width+2;break;case t.type.BOLD_DOUBLE_LEFT:e(this.ctx,this.type,o+this.x_shift,i,s);break;case t.type.BOLD_DOUBLE_RIGHT:e(this.ctx,this.type,o,i,s);break;case t.type.THIN_DOUBLE:h=1}if(this.type!==t.type.BRACE&&this.type!==t.type.BOLD_DOUBLE_LEFT&&this.type!==t.type.BOLD_DOUBLE_RIGHT&&this.ctx.fillRect(o,i,h,_),this.type===t.type.THIN_DOUBLE&&this.ctx.fillRect(o-3,i,h,_),void 0!==this.text){this.ctx.save(),this.ctx.lineWidth=2,this.ctx.setFont(this.font.family,this.font.size,this.font.weight);var U=this.ctx.measureText(""+this.text).width,d=this.top_stave.getX()-U-24+this.text_options.shift_x,m=(this.top_stave.getYForLine(0)+this.bottom_stave.getBottomLineY())/2+this.text_options.shift_y;this.ctx.fillText(""+this.text,d,m+4),this.ctx.restore()}}},t}();Vex.Flow.TabStave=function(){function e(e,t,n,i){arguments.length>0&&this.init(e,t,n,i)}return Vex.Inherit(e,Vex.Flow.Stave,{init:function(t,n,i,s){var a={spacing_between_lines_px:13,num_lines:6,top_text_position:1};Vex.Merge(a,s),e.superclass.init.call(this,t,n,i,a)},getYForGlyphs:function(){return this.getYForLine(2.5)},addTabGlyph:function(){var e,t;switch(this.options.num_lines){case 8:e=55,t=14;break;case 7:e=47,t=8;break;case 6:e=40,t=1;break;case 5:e=30,t=-6;break;case 4:e=23,t=-12}var n=new Vex.Flow.Glyph("v2f",e);return n.y_shift=t,this.addGlyph(n),this}}),e}();Vex.Flow.TickContext=function(){function t(){this.init()}return t.prototype={init:function(){this.currentTick=new Vex.Flow.Fraction(0,1),this.maxTicks=new Vex.Flow.Fraction(0,1),this.minTicks=null,this.width=0,this.padding=3,this.pixelsUsed=0,this.x=0,this.tickables=[],this.notePx=0,this.extraLeftPx=0,this.extraRightPx=0,this.align_center=!1,this.tContexts=[],this.ignore_ticks=!0,this.preFormatted=!1,this.postFormatted=!1,this.context=null},setContext:function(t){return this.context=t,this},getContext:function(){return this.context},shouldIgnoreTicks:function(){return this.ignore_ticks},getWidth:function(){return this.width+2*this.padding},getX:function(){return this.x},setX:function(t){return this.x=t,this},getPixelsUsed:function(){return this.pixelsUsed},setPixelsUsed:function(t){return this.pixelsUsed=t,this},setPadding:function(t){return this.padding=t,this},getMaxTicks:function(){return this.maxTicks},getMinTicks:function(){return this.minTicks},getTickables:function(){return this.tickables},getCenterAlignedTickables:function(){return this.tickables.filter(function(t){return t.isCenterAligned()})},getMetrics:function(){return{width:this.width,notePx:this.notePx,extraLeftPx:this.extraLeftPx,extraRightPx:this.extraRightPx}},getCurrentTick:function(){return this.currentTick},setCurrentTick:function(t){this.currentTick=t,this.preFormatted=!1},getExtraPx:function(){for(var t=0,i=0,e=0,s=0,n=0;n<this.tickables.length;n++){e=Math.max(this.tickables[n].extraLeftPx,e),s=Math.max(this.tickables[n].extraRightPx,s);var r=this.tickables[n].modifierContext;r&&null!=r&&(t=Math.max(t,r.state.left_shift),i=Math.max(i,r.state.right_shift))}return{left:t,right:i,extraLeft:e,extraRight:s}},addTickable:function(t){if(!t)throw new Vex.RERR("BadArgument","Invalid tickable added.");if(!t.shouldIgnoreTicks()){this.ignore_ticks=!1;var i=t.getTicks();i.greaterThan(this.maxTicks)&&(this.maxTicks=i.clone()),null==this.minTicks?this.minTicks=i.clone():i.lessThan(this.minTicks)&&(this.minTicks=i.clone())}return t.setTickContext(this),this.tickables.push(t),this.preFormatted=!1,this},preFormat:function(){if(!this.preFormatted){for(var t=0;t<this.tickables.length;++t){var i=this.tickables[t];i.preFormat();var e=i.getMetrics();this.extraLeftPx=Math.max(this.extraLeftPx,e.extraLeftPx+e.modLeftPx),this.extraRightPx=Math.max(this.extraRightPx,e.extraRightPx+e.modRightPx),this.notePx=Math.max(this.notePx,e.noteWidth),this.width=this.notePx+this.extraLeftPx+this.extraRightPx}return this}},postFormat:function(){return this.postFormatted?this:(this.postFormatted=!0,this)}},t.getNextContext=function(t){var i=t.tContexts,e=i.indexOf(t);return i[e+1]},t}();Vex.Flow.Tickable=function(){function t(){this.init()}return t.prototype={init:function(){this.intrinsicTicks=0,this.tickMultiplier=new Vex.Flow.Fraction(1,1),this.ticks=new Vex.Flow.Fraction(0,1),this.width=0,this.x_shift=0,this.voice=null,this.tickContext=null,this.modifierContext=null,this.modifiers=[],this.preFormatted=!1,this.postFormatted=!1,this.tuplet=null,this.align_center=!1,this.center_x_shift=0,this.ignore_ticks=!1,this.context=null},setContext:function(t){this.context=t},getBoundingBox:function(){return null},getTicks:function(){return this.ticks},shouldIgnoreTicks:function(){return this.ignore_ticks},getWidth:function(){return this.width},setXShift:function(t){this.x_shift=t},getCenterXShift:function(){return this.isCenterAligned()?this.center_x_shift:0},isCenterAligned:function(){return this.align_center},setCenterAlignment:function(t){return this.align_center=t,this},getVoice:function(){if(!this.voice)throw new Vex.RERR("NoVoice","Tickable has no voice.");return this.voice},setVoice:function(t){this.voice=t},getTuplet:function(){return this.tuplet},setTuplet:function(t){var i,e;return this.tuplet&&(i=this.tuplet.getNoteCount(),e=this.tuplet.getBeatsOccupied(),this.applyTickMultiplier(i,e)),t&&(i=t.getNoteCount(),e=t.getBeatsOccupied(),this.applyTickMultiplier(e,i)),this.tuplet=t,this},addToModifierContext:function(t){this.modifierContext=t,this.preFormatted=!1},addModifier:function(t){return this.modifiers.push(t),this.preFormatted=!1,this},setTickContext:function(t){this.tickContext=t,this.preFormatted=!1},preFormat:function(){this.preFormatted||(this.width=0,this.modifierContext&&(this.modifierContext.preFormat(),this.width+=this.modifierContext.getWidth()))},postFormat:function(){return this.postFormatted?void 0:(this.postFormatted=!0,this)},getIntrinsicTicks:function(){return this.intrinsicTicks},setIntrinsicTicks:function(t){this.intrinsicTicks=t,this.ticks=this.tickMultiplier.clone().multiply(this.intrinsicTicks)},getTickMultiplier:function(){return this.tickMultiplier},applyTickMultiplier:function(t,i){this.tickMultiplier.multiply(t,i),this.ticks=this.tickMultiplier.clone().multiply(this.intrinsicTicks)},setDuration:function(t){var i=t.numerator*(Vex.Flow.RESOLUTION/t.denominator);this.ticks=this.tickMultiplier.clone().multiply(i),this.intrinsicTicks=this.ticks.value()}},t}();Vex.Flow.Note=function(){function t(t){arguments.length>0&&this.init(t)}return t.CATEGORY="note",Vex.Inherit(t,Vex.Flow.Tickable,{init:function(e){if(t.superclass.init.call(this),!e)throw new Vex.RuntimeError("BadArguments","Note must have valid initialization data to identify duration and type.");var i=Vex.Flow.parseNoteData(e);if(!i)throw new Vex.RuntimeError("BadArguments","Invalid note initialization object: "+JSON.stringify(e));if(this.duration=i.duration,this.dots=i.dots,this.noteType=i.type,e.duration_override?this.setDuration(e.duration_override):this.setIntrinsicTicks(i.ticks),this.modifiers=[],this.glyph=Vex.Flow.durationToGlyph(this.duration,this.noteType),this.positions&&("object"!=typeof this.positions||!this.positions.length))throw new Vex.RuntimeError("BadArguments","Note keys must be array type.");this.playNote=null,this.tickContext=null,this.modifierContext=null,this.ignore_ticks=!1,this.width=0,this.extraLeftPx=0,this.extraRightPx=0,this.x_shift=0,this.left_modPx=0,this.right_modPx=0,this.voice=null,this.preFormatted=!1,this.ys=[],e.align_center&&this.setCenterAlignment(e.align_center),this.context=null,this.stave=null,this.render_options={annotation_spacing:5,stave_padding:12}},getPlayNote:function(){return this.playNote},setPlayNote:function(t){return this.playNote=t,this},isRest:function(){return!1},addStroke:function(t,e){return e.setNote(this),e.setIndex(t),this.modifiers.push(e),this.setPreFormatted(!1),this},getStave:function(){return this.stave},setStave:function(t){return this.stave=t,this.setYs([t.getYForLine(0)]),this.context=this.stave.context,this},getCategory:function(){return this.constructor.CATEGORY},setContext:function(t){return this.context=t,this},getExtraLeftPx:function(){return this.extraLeftPx},getExtraRightPx:function(){return this.extraRightPx},setExtraLeftPx:function(t){return this.extraLeftPx=t,this},setExtraRightPx:function(t){return this.extraRightPx=t,this},shouldIgnoreTicks:function(){return this.ignore_ticks},getLineNumber:function(){return 0},getLineForRest:function(){return 0},getGlyph:function(){return this.glyph},setYs:function(t){return this.ys=t,this},getYs:function(){if(0===this.ys.length)throw new Vex.RERR("NoYValues","No Y-values calculated for this note.");return this.ys},getYForTopText:function(t){if(!this.stave)throw new Vex.RERR("NoStave","No stave attached to this note.");return this.stave.getYForTopText(t)},getBoundingBox:function(){return null},getVoice:function(){if(!this.voice)throw new Vex.RERR("NoVoice","Note has no voice.");return this.voice},setVoice:function(t){return this.voice=t,this.preFormatted=!1,this},getTickContext:function(){return this.tickContext},setTickContext:function(t){return this.tickContext=t,this.preFormatted=!1,this},getDuration:function(){return this.duration},isDotted:function(){return this.dots>0},hasStem:function(){return!1},getDots:function(){return this.dots},getNoteType:function(){return this.noteType},setBeam:function(){return this},setModifierContext:function(t){return this.modifierContext=t,this},addModifier:function(t,e){return t.setNote(this),t.setIndex(e||0),this.modifiers.push(t),this.setPreFormatted(!1),this},getModifierStartXY:function(){if(!this.preFormatted)throw new Vex.RERR("UnformattedNote","Can't call GetModifierStartXY on an unformatted note");return{x:this.getAbsoluteX(),y:this.ys[0]}},getMetrics:function(){if(!this.preFormatted)throw new Vex.RERR("UnformattedNote","Can't call getMetrics on an unformatted note.");var t=0,e=0;null!=this.modifierContext&&(t=this.modifierContext.state.left_shift,e=this.modifierContext.state.right_shift);var i=this.getWidth();return{width:i,noteWidth:i-t-e-this.extraLeftPx-this.extraRightPx,left_shift:this.x_shift,modLeftPx:t,modRightPx:e,extraLeftPx:this.extraLeftPx,extraRightPx:this.extraRightPx}},setWidth:function(t){this.width=t},getWidth:function(){if(!this.preFormatted)throw new Vex.RERR("UnformattedNote","Can't call GetWidth on an unformatted note.");return this.width+(this.modifierContext?this.modifierContext.getWidth():0)},setXShift:function(t){return this.x_shift=t,this},getX:function(){if(!this.tickContext)throw new Vex.RERR("NoTickContext","Note needs a TickContext assigned for an X-Value");return this.tickContext.getX()+this.x_shift},getAbsoluteX:function(){if(!this.tickContext)throw new Vex.RERR("NoTickContext","Note needs a TickContext assigned for an X-Value");var t=this.tickContext.getX();return this.stave&&(t+=this.stave.getNoteStartX()+this.render_options.stave_padding),this.isCenterAligned()&&(t+=this.getCenterXShift()),t},setPreFormatted:function(t){if(this.preFormatted=t,this.preFormatted){var e=this.tickContext.getExtraPx();this.left_modPx=Math.max(this.left_modPx,e.left),this.right_modPx=Math.max(this.right_modPx,e.right)}}}),t}();Vex.Flow.NoteHead=function(){function t(){i.DEBUG&&Vex.L("Vex.Flow.NoteHead",arguments)}function e(t,e,i,s,n){var o=15+Vex.Flow.STEM_WIDTH/2;t.save(),t.setLineWidth(Vex.Flow.STEM_WIDTH);var h=!1;if(Vex.Flow.durationToNumber(e)>2&&(h=!0),h||(i-=Vex.Flow.STEM_WIDTH/2*n),t.beginPath(),t.moveTo(i,s+11),t.lineTo(i,s+1),t.lineTo(i+o,s-10),t.lineTo(i+o,s),t.lineTo(i,s+11),t.closePath(),h?t.fill():t.stroke(),Vex.Flow.durationToFraction(e).equals(.5))for(var r=[-3,-1,o+1,o+3],l=0;l<r.length;l++)t.beginPath(),t.moveTo(i+r[l],s-10),t.lineTo(i+r[l],s+11),t.stroke();t.restore()}var i=function(t){arguments.length>0&&this.init(t)};return Vex.Inherit(i,Vex.Flow.Note,{init:function(t){if(i.superclass.init.call(this,t),this.index=t.index,this.x=t.x||0,this.y=t.y||0,this.note_type=t.note_type,this.duration=t.duration,this.displaced=t.displaced||!1,this.stem_direction=t.stem_direction||Vex.Flow.StaveNote.STEM_UP,this.line=t.line,this.glyph=Vex.Flow.durationToGlyph(this.duration,this.note_type),!this.glyph)throw new Vex.RuntimeError("BadArguments","No glyph found for duration '"+this.duration+"' and type '"+this.note_type+"'");this.glyph_code=this.glyph.code_head,this.x_shift=t.x_shift,t.custom_glyph_code&&(this.custom_glyph=!0,this.glyph_code=t.custom_glyph_code),this.context=null,this.style=t.style,this.slashed=t.slashed,Vex.Merge(this.render_options,{glyph_font_scale:35,stroke_px:3}),t.glyph_font_scale&&(this.render_options.glyph_font_scale=t.glyph_font_scale),this.setWidth(this.glyph.head_width)},getCategory:function(){return"notehead"},setContext:function(t){return this.context=t,this},getWidth:function(){return this.width},isDisplaced:function(){return this.displaced===!0},getStyle:function(){return this.style},setStyle:function(t){return this.style=t,this},getGlyph:function(){return this.glyph},setX:function(t){return this.x=t,this},getY:function(){return this.y},setY:function(t){return this.y=t,this},getLine:function(){return this.line},setLine:function(t){return this.line=t,this},getAbsoluteX:function(){var t=i.superclass.getAbsoluteX,e=this.preFormatted?t.call(this):this.x;return e+(this.displaced?this.width*this.stem_direction:0)},getBoundingBox:function(){if(!this.preFormatted)throw new Vex.RERR("UnformattedNote","Can't call getBoundingBox on an unformatted note.");var t=this.stave.getSpacingBetweenLines(),e=t/2,i=this.y-e;return new Vex.Flow.BoundingBox(this.getAbsoluteX(),i,this.width,t)},applyStyle:function(t){var e=this.getStyle();return e.shadowColor&&t.setShadowColor(e.shadowColor),e.shadowBlur&&t.setShadowBlur(e.shadowBlur),e.fillStyle&&t.setFillStyle(e.fillStyle),e.strokeStyle&&t.setStrokeStyle(e.strokeStyle),this},setStave:function(t){var e=this.getLine();return this.stave=t,this.setY(t.getYForNote(e)),this.context=this.stave.context,this},preFormat:function(){if(this.preFormatted)return this;var t=this.getGlyph(),e=t.head_width+this.extraLeftPx+this.extraRightPx;return this.setWidth(e),this.setPreFormatted(!0),this},draw:function(){if(!this.context)throw new Vex.RERR("NoCanvasContext","Can't draw without a canvas context.");var i=this.context,s=this.getAbsoluteX(),n=this.y;t("Drawing note head '",this.note_type,this.duration,"' at",s,n);var o=this.stem_direction,h=this.render_options.glyph_font_scale,r=this.line;if(0>=r||r>=6){var l=n,a=Math.floor(r);0>r&&a-r==-.5?l-=5:r>6&&a-r==-.5&&(l+=5),"r"!=this.note_type&&i.fillRect(s-this.render_options.stroke_px,l,this.getGlyph().head_width+2*this.render_options.stroke_px,1)}"s"==this.note_type?e(i,this.duration,s,n,o):this.style?(i.save(),this.applyStyle(i),Vex.Flow.renderGlyph(i,s,n,h,this.glyph_code),i.restore()):Vex.Flow.renderGlyph(i,s,n,h,this.glyph_code)}}),i}();Vex.Flow.Stem=function(){function t(){e.DEBUG&&Vex.L("Vex.Flow.Stem",arguments)}var e=function(t){arguments.length>0&&this.init(t)};return e.UP=1,e.DOWN=-1,e.WIDTH=Vex.Flow.STEM_WIDTH,e.HEIGHT=Vex.Flow.STEM_HEIGHT,e.prototype={init:function(t){this.x_begin=t.x_begin||0,this.x_end=t.x_end||0,this.y_top=t.y_top||0,this.y_bottom=t.y_bottom||0,this.y_extend=t.y_extend||0,this.stem_extension=t.stem_extension||0,this.stem_direction=t.stem_direction||0,this.hide=!1},setNoteHeadXBounds:function(t,e){return this.x_begin=t,this.x_end=e,this},setDirection:function(t){this.stem_direction=t},setExtension:function(t){this.stem_extension=t},setYBounds:function(t,e){this.y_top=t,this.y_bottom=e},getCategory:function(){return"stem"},setContext:function(t){return this.context=t,this},getHeight:function(){return(this.y_bottom-this.y_top)*this.stem_direction+(e.HEIGHT+this.stem_extension)*this.stem_direction},getBoundingBox:function(){throw new Vex.RERR("NotImplemented","getBoundingBox() not implemented.")},getExtents:function(){for(var t=[this.y_top,this.y_bottom],i=this.y_top,n=this.y_bottom,o=e.HEIGHT+this.stem_extension,s=0;s<t.length;++s){var h=t[s]+o*-this.stem_direction;this.stem_direction==e.DOWN?(i=i>h?i:h,n=n<t[s]?n:t[s]):(i=h>i?i:h,n=n>t[s]?n:t[s])}return{topY:i,baseY:n}},draw:function(){if(!this.context)throw new Vex.RERR("NoCanvasContext","Can't draw without a canvas context.");if(!this.hide){var i,n,o=this.context,s=this.stem_direction;s==e.DOWN?(i=this.x_begin+e.WIDTH/2,n=this.y_top+2):(i=this.x_end+e.WIDTH/2,n=this.y_bottom-2),n+=this.y_extend*s,t("Rendering stem - ","Top Y: ",this.y_top,"Bottom Y: ",this.y_bottom),o.save(),o.beginPath(),o.setLineWidth(e.WIDTH),o.moveTo(i,n),o.lineTo(i,n-this.getHeight()),o.stroke(),o.restore()}}},e}();Vex.Flow.StemmableNote=function(){function t(){e.DEBUG&&Vex.L("Vex.Flow.StemmableNote",arguments)}var e=function(t){arguments.length>0&&this.init(t)},s=Vex.Flow.Stem;return Vex.Inherit(e,Vex.Flow.Note,{init:function(t){e.superclass.init.call(this,t),this.stem=null,this.stem_extension_override=null,this.beam=null},getStem:function(){return this.stem},setStem:function(t){return this.stem=t,this},buildStem:function(){var t=new s;return this.setStem(t),this},getStemLength:function(){return s.HEIGHT+this.getStemExtension()},getBeamCount:function(){var t=this.getGlyph();return t?t.beam_count:0},getStemMinumumLength:function(){var t=Vex.Flow.durationToFraction(this.duration),e=t.value()<=1?0:20;switch(this.duration){case"8":null==this.beam&&(e=35);break;case"16":e=null==this.beam?35:25;break;case"32":e=null==this.beam?45:35;break;case"64":e=null==this.beam?50:40;break;case"128":e=null==this.beam?55:45}return e},getStemDirection:function(){return this.stem_direction},setStemDirection:function(t){if(t||(t=s.UP),t!=s.UP&&t!=s.DOWN)throw new Vex.RERR("BadArgument","Invalid stem direction: "+t);return this.stem_direction=t,this.stem&&(this.stem.setDirection(t),this.stem.setExtension(this.getStemExtension())),this.beam=null,this.preFormatted&&this.preFormat(),this},getStemX:function(){var t=this.getAbsoluteX()+this.x_shift,e=this.getAbsoluteX()+this.x_shift+this.glyph.head_width,i=this.stem_direction==s.DOWN?t:e;return i-=s.WIDTH/2*this.stem_direction},getCenterGlyphX:function(){return this.getAbsoluteX()+this.x_shift+this.glyph.head_width/2},getStemExtension:function(){var t=this.getGlyph();return null!=this.stem_extension_override?this.stem_extension_override:t?1===this.getStemDirection()?t.stem_up_extension:t.stem_down_extension:0},setStemLength:function(t){return this.stem_extension_override=t-s.HEIGHT,this},getStemExtents:function(){if(!this.ys||0===this.ys.length)throw new Vex.RERR("NoYValues","Can't get top stem Y when note has no Y values.");for(var e=this.ys[0],i=this.ys[0],n=s.HEIGHT+this.getStemExtension(),o=0;o<this.ys.length;++o){var h=this.ys[o]+n*-this.stem_direction;this.stem_direction==s.DOWN?(e=e>h?e:h,i=i<this.ys[o]?i:this.ys[o]):(e=h>e?e:h,i=i>this.ys[o]?i:this.ys[o]),("s"==this.noteType||"x"==this.noteType)&&(e-=7*this.stem_direction,i-=7*this.stem_direction)}return t("Stem extents: ",e,i),{topY:e,baseY:i}},setBeam:function(t){return this.beam=t,this},getYForTopText:function(t){var e=this.getStemExtents();return this.hasStem()?Vex.Min(this.stave.getYForTopText(t),e.topY-this.render_options.annotation_spacing*(t+1)):this.stave.getYForTopText(t)},getYForBottomText:function(t){var e=this.getStemExtents();return this.hasStem()?Vex.Max(this.stave.getYForTopText(t),e.baseY+this.render_options.annotation_spacing*t):this.stave.getYForBottomText(t)},postFormat:function(){return this.beam&&this.beam.postFormat(),this.postFormatted=!0,this},drawStem:function(t){if(!this.context)throw new Vex.RERR("NoCanvasContext","Can't draw without a canvas context.");this.setStem(new s(t)),this.stem.setContext(this.context).draw()}}),e}();Vex.Flow.StaveNote=function(){function t(){e.DEBUG&&Vex.L("Vex.Flow.StaveNote",arguments)}var e=function(t){arguments.length>0&&this.init(t)};e.CATEGORY="stavenotes";var i=Vex.Flow.Stem,s=Vex.Flow.NoteHead;e.STEM_UP=i.UP,e.STEM_DOWN=i.DOWN;var n=function(t,e,i){var s=(e.isrest?0:1)*i;t.line+=s,t.max_line+=s,t.min_line+=s,t.note.setKeyLine(0,t.note.getKeyLine(0)+s)},o=function(t,e,i){var s=t.line-Vex.MidLine(e.min_line,i.max_line);t.note.setKeyLine(0,t.note.getKeyLine(0)-s),t.line-=s,t.max_line-=s,t.min_line-=s};return e.format=function(t,i){if(!t||t.length<2)return!1;if(null!=t[0].getStave())return e.formatByY(t,i);for(var s=[],r=0;r<t.length;r++){var h,a=t[r].getKeyProps(),l=a[0].line,d=a[a.length-1].line,u=t[r].getStemDirection(),f=t[r].getStemLength()/10,g=t[r].getStemMinumumLength()/10;t[r].isRest()?(h=l+t[r].glyph.line_above,d=l-t[r].glyph.line_below):(h=1==u?a[a.length-1].line+f:a[a.length-1].line,d=1==u?a[0].line:a[0].line-f),s.push({line:a[0].line,max_line:h,min_line:d,isrest:t[r].isRest(),stem_dir:u,stem_max:f,stem_min:g,voice_shift:t[r].getVoiceShiftWidth(),is_displaced:t[r].isDisplaced(),note:t[r]})}var c=s.length,_=s[0],m=c>2?s[1]:null,x=c>2?s[2]:s[1];2==c&&-1==_.stem_dir&&1==x.stem_dir&&(_=s[1],x=s[0]);var p,v=Math.max(_.voice_shift,x.voice_shift),y=0;if(2==c){var w=_.stem_dir==x.stem_dir?0:.5;return _.stem_dir==x.stem_dir&&_.min_line<=x.max_line&&(_.isrest||(p=Math.abs(_.line-(x.max_line+.5)),p=Math.max(p,_.stem_min),_.min_line=_.line-p,_.note.setStemLength(10*p))),_.min_line<=x.max_line+w&&(_.isrest?n(_,x,1):x.isrest?n(x,_,-1):(y=v,_.stem_dir==x.stem_dir?_.note.setXShift(y+3):x.note.setXShift(y))),!0}if(null!=m&&m.min_line<x.max_line+.5&&(m.isrest||(p=Math.abs(m.line-(x.max_line+.5)),p=Math.max(p,m.stem_min),m.min_line=m.line-p,m.note.setStemLength(10*p))),m.isrest&&!_.isrest&&!x.isrest&&(_.min_line<=m.max_line||m.min_line<=x.max_line)){var S=m.max_line-m.min_line,R=_.min_line-x.max_line;return R>S?o(m,_,x):(y=v+3,m.note.setXShift(y)),!0}return _.isrest&&m.isrest&&x.isrest?(n(_,m,1),n(x,m,-1),!0):(m.isrest&&_.isrest&&m.min_line<=x.max_line&&n(m,x,1),m.isrest&&x.isrest&&_.min_line<=m.max_line&&n(m,_,-1),_.isrest&&_.min_line<=m.max_line&&n(_,m,1),x.isrest&&m.min_line<=x.max_line&&n(x,m,-1),(!_.isrest&&!m.isrest&&_.min_line<=m.max_line+.5||!m.isrest&&!x.isrest&&m.min_line<=x.max_line)&&(y=v+3,m.note.setXShift(y)),!0)},e.formatByY=function(t,e){var i,s=!0;for(i=0;i<t.length;i++)s=s&&null!=t[i].getStave();if(!s)throw new Vex.RERR("Stave Missing","All notes must have a stave - Vex.Flow.ModifierContext.formatMultiVoice!");var n=0;for(i=0;i<t.length-1;i++){var o=t[i],r=t[i+1];o.getStemDirection()==Vex.Flow.StaveNote.STEM_DOWN&&(o=t[i+1],r=t[i]);var h=o.getKeyProps(),a=r.getKeyProps(),l=o.getStave().getYForLine(h[0].line),d=r.getStave().getYForLine(a[a.length-1].line),u=o.getStave().options.spacing_between_lines_px;Math.abs(l-d)==u/2&&(n=o.getVoiceShiftWidth(),r.setXShift(n))}e.right_shift+=n},e.postFormat=function(t){return t?(t.forEach(function(t){t.postFormat()}),!0):!1},Vex.Inherit(e,Vex.Flow.StemmableNote,{init:function(t){if(e.superclass.init.call(this,t),this.keys=t.keys,this.clef=t.clef,this.octave_shift=t.octave_shift,this.beam=null,this.glyph=Vex.Flow.durationToGlyph(this.duration,this.noteType),!this.glyph)throw new Vex.RuntimeError("BadArguments","Invalid note initialization data (No glyph found): "+JSON.stringify(t));this.displaced=!1,this.dot_shiftY=0,this.keyProps=[],this.use_default_head_x=!1,this.note_heads=[],this.modifiers=[],Vex.Merge(this.render_options,{glyph_font_scale:35,stroke_px:3}),this.calculateKeyProps(),this.buildStem(),t.auto_stem?this.autoStem():this.setStemDirection(t.stem_direction),this.buildNoteHeads(),this.calcExtraPx()},buildStem:function(){var t=this.getGlyph(),e=0;("v95"==t.code_head||"v3e"==t.code_head)&&(e=-4);var s=new i({y_extend:e});this.isRest()&&(s.hide=!0),this.setStem(s)},buildNoteHeads:function(){var t=this.getStemDirection(),e=this.getKeys(),n=null,o=null,r=!1,h=0,a=e.length,l=1;t===i.DOWN&&(h=e.length-1,a=-1,l=-1);for(var d=h;d!=a;d+=l){var u=this.keyProps[d],f=u.line;null===n?n=f:(o=Math.abs(n-f),0===o||.5===o?r=!r:(r=!1,this.use_default_head_x=!0)),n=f;var g=new s({duration:this.duration,note_type:this.noteType,displaced:r,stem_direction:t,custom_glyph_code:u.code,glyph_font_scale:this.render_options.glyph_font_scale,x_shift:u.shift_right,line:u.line});this.note_heads[d]=g}},autoStem:function(){var t;this.min_line=this.keyProps[0].line,this.max_line=this.keyProps[this.keyProps.length-1].line;var e=(this.min_line+this.max_line)/2;t=3>e?1:-1,this.setStemDirection(t)},calculateKeyProps:function(){for(var t=null,e=0;e<this.keys.length;++e){var i=this.keys[e];this.glyph.rest&&(this.glyph.position=i);var s={octave_shift:this.octave_shift||0},n=Vex.Flow.keyProperties(i,this.clef,s);if(!n)throw new Vex.RuntimeError("BadArguments","Invalid key for note properties: "+i);"R"===n.key&&(n.line="1"===this.duration||"w"===this.duration?4:3);var o=n.line;null===t?t=o:.5==Math.abs(t-o)&&(this.displaced=!0,n.displaced=!0,this.keyProps.length>0&&(this.keyProps[e-1].displaced=!0)),t=o,this.keyProps.push(n)}this.keyProps.sort(function(t,e){return t.line-e.line})},getBoundingBox:function(){if(!this.preFormatted)throw new Vex.RERR("UnformattedNote","Can't call getBoundingBox on an unformatted note.");var t=this.getMetrics(),e=t.width,i=this.getAbsoluteX()-t.modLeftPx-t.extraLeftPx,s=0,n=0,o=this.getStave().getSpacingBetweenLines()/2,r=2*o;if(this.isRest()){var h=this.ys[0],a=Vex.Flow.durationToFraction(this.duration);a.equals(1)||a.equals(2)?(s=h-o,n=h+o):(s=h-this.glyph.line_above*r,n=h+this.glyph.line_below*r)}else if(this.glyph.stem){var l=this.getStemExtents();l.baseY+=o*this.stem_direction,s=Vex.Min(l.topY,l.baseY),n=Vex.Max(l.topY,l.baseY)}else{s=null,n=null;for(var d=0;d<this.ys.length;++d){var u=this.ys[d];0===d?(s=u,n=u):(s=Vex.Min(u,s),n=Vex.Max(u,n)),s-=o,n+=o}}return new Vex.Flow.BoundingBox(i,s,e,n-s)},getLineNumber:function(t){if(!this.keyProps.length)throw new Vex.RERR("NoKeyProps","Can't get bottom note line, because note is not initialized properly.");for(var e=this.keyProps[0].line,i=0;i<this.keyProps.length;i++){var s=this.keyProps[i].line;t&&(s>e?e=s:e>s&&(e=s))}return e},isRest:function(){return this.glyph.rest},isChord:function(){return!this.isRest()&&this.keys.length>1},hasStem:function(){return this.glyph.stem},getYForTopText:function(t){var e=this.getStemExtents();return Vex.Min(this.stave.getYForTopText(t),e.topY-this.render_options.annotation_spacing*(t+1))},getYForBottomText:function(t){var e=this.getStemExtents();return Vex.Max(this.stave.getYForTopText(t),e.baseY+this.render_options.annotation_spacing*t)},setStave:function(t){var e=Vex.Flow.StaveNote.superclass;e.setStave.call(this,t);var i=this.note_heads.map(function(e){return e.setStave(t),e.getY()});this.setYs(i);var s=this.getNoteHeadBounds();return this.beam||this.stem.setYBounds(s.y_top,s.y_bottom),this},getKeys:function(){return this.keys},getKeyProps:function(){return this.keyProps},isDisplaced:function(){return this.displaced},setNoteDisplaced:function(t){return this.displaced=t,this},getTieRightX:function(){var t=this.getAbsoluteX();return t+=this.glyph.head_width+this.x_shift+this.extraRightPx,this.modifierContext&&(t+=this.modifierContext.getExtraRightPx()),t},getTieLeftX:function(){var t=this.getAbsoluteX();return t+=this.x_shift-this.extraLeftPx},getLineForRest:function(){var t=this.keyProps[0].line;if(this.keyProps.length>1){var e=this.keyProps[this.keyProps.length-1].line,i=Vex.Max(t,e),s=Vex.Min(t,e);t=Vex.MidLine(i,s)}return t},getModifierStartXY:function(t,e){if(!this.preFormatted)throw new Vex.RERR("UnformattedNote","Can't call GetModifierStartXY on an unformatted note");if(0===this.ys.length)throw new Vex.RERR("NoYValues","No Y-Values calculated for this note.");var i=0;return t==Vex.Flow.Modifier.Position.LEFT?i=-2:t==Vex.Flow.Modifier.Position.RIGHT?i=this.glyph.head_width+this.x_shift+2:(t==Vex.Flow.Modifier.Position.BELOW||t==Vex.Flow.Modifier.Position.ABOVE)&&(i=this.glyph.head_width/2),{x:this.getAbsoluteX()+i,y:this.ys[e]}},setKeyStyle:function(t,e){return this.note_heads[t].setStyle(e),this},setKeyLine:function(t,e){return this.keyProps[t].line=e,this.note_heads[t].setLine(e),this},getKeyLine:function(t){return this.keyProps[t].line},addToModifierContext:function(t){this.setModifierContext(t);for(var e=0;e<this.modifiers.length;++e)this.modifierContext.addModifier(this.modifiers[e]);return this.modifierContext.addModifier(this),this.setPreFormatted(!1),this},addModifier:function(t,e){return e.setNote(this),e.setIndex(t),this.modifiers.push(e),this.setPreFormatted(!1),this},addAccidental:function(t,e){return this.addModifier(t,e)},addArticulation:function(t,e){return this.addModifier(t,e)},addAnnotation:function(t,e){return this.addModifier(t,e)},addDot:function(t){var e=new Vex.Flow.Dot;return e.setDotShiftY(this.glyph.dot_shiftY),this.dots++,this.addModifier(t,e)},addDotToAll:function(){for(var t=0;t<this.keys.length;++t)this.addDot(t);return this},getAccidentals:function(){return this.modifierContext.getModifiers("accidentals")},getDots:function(){return this.modifierContext.getModifiers("dots")},getVoiceShiftWidth:function(){return this.glyph.head_width*(this.displaced?2:1)},calcExtraPx:function(){this.setExtraLeftPx(this.displaced&&-1==this.stem_direction?this.glyph.head_width:0),this.setExtraRightPx(this.displaced&&1==this.stem_direction?this.glyph.head_width:0)},preFormat:function(){if(!this.preFormatted){this.modifierContext&&this.modifierContext.preFormat();var t=this.glyph.head_width+this.extraLeftPx+this.extraRightPx;this.glyph.flag&&null===this.beam&&1==this.stem_direction&&(t+=this.glyph.head_width),this.setWidth(t),this.setPreFormatted(!0)}},getNoteHeadBounds:function(){var t=null,e=null,i=this.stave.getNumLines(),s=1;return this.note_heads.forEach(function(n){var o=n.getLine(),r=n.getY();(null===t||t>r)&&(t=r),(null===e||r>e)&&(e=r),i=o>i?o:i,s=s>o?o:s},this),{y_top:t,y_bottom:e,highest_line:i,lowest_line:s}},getNoteHeadBeginX:function(){return this.getAbsoluteX()+this.x_shift},getNoteHeadEndX:function(){var t=this.getNoteHeadBeginX();return t+this.glyph.head_width-Vex.Flow.STEM_WIDTH/2},drawLedgerLines:function(){function t(t){h.use_default_head_x===!0&&(r=h.getAbsoluteX()+h.x_shift);var e=r-h.render_options.stroke_px,s=r+h.glyph.head_width-r+2*h.render_options.stroke_px;i.fillRect(e,t,s,1)}if(!this.isRest()){if(!this.context)throw new Vex.RERR("NoCanvasContext","Can't draw without a canvas context.");var e,i=this.context,s=this.getNoteHeadBounds(),n=s.highest_line,o=s.lowest_line,r=this.note_heads[0].getAbsoluteX(),h=this;for(e=6;n>=e;++e)t(this.stave.getYForNote(e));for(e=0;e>=o;--e)t(this.stave.getYForNote(e))}},drawModifiers:function(){if(!this.context)throw new Vex.RERR("NoCanvasContext","Can't draw without a canvas context.");for(var t=this.context,e=0;e<this.modifiers.length;e++){var i=this.modifiers[e],s=this.note_heads[i.getIndex()],n=s.getStyle();n&&(t.save(),s.applyStyle(t)),i.setContext(t),i.draw(),n&&t.restore()}},drawFlag:function(){if(!this.context)throw new Vex.RERR("NoCanvasContext","Can't draw without a canvas context.");var t=this.context,e=this.getGlyph(),s=null===this.beam,n=this.getNoteHeadBounds(),o=this.getNoteHeadBeginX(),r=this.getNoteHeadEndX();if(e.flag&&s){var h,a,l,d=this.stem.getHeight();this.getStemDirection()===i.DOWN?(h=o+1,a=n.y_top-d+2,l=e.code_flag_downstem):(h=r+1,a=n.y_bottom-d-2,l=e.code_flag_upstem),Vex.Flow.renderGlyph(t,h,a,this.render_options.glyph_font_scale,l)}},drawNoteHeads:function(){this.note_heads.forEach(function(t){t.setContext(this.context).draw()},this)},drawStem:function(t){if(!this.context)throw new Vex.RERR("NoCanvasContext","Can't draw without a canvas context.");t&&this.setStem(new i(t)),this.stem.setContext(this.context).draw()},draw:function(){if(!this.context)throw new Vex.RERR("NoCanvasContext","Can't draw without a canvas context.");if(!this.stave)throw new Vex.RERR("NoStave","Can't draw without a stave.");if(0===this.ys.length)throw new Vex.RERR("NoYValues","Can't draw note without Y values.");var e=this.getNoteHeadBeginX(),i=this.getNoteHeadEndX(),s=this.hasStem()&&!this.beam;this.note_heads.forEach(function(t){t.setX(e)},this),this.stem.setNoteHeadXBounds(e,i),t("Rendering ",this.isChord()?"chord :":"note :",this.keys),this.drawLedgerLines(),s&&this.drawStem(),this.drawNoteHeads(),this.drawFlag(),this.drawModifiers()}}),e}();Vex.Flow.TabNote=function(){function t(t,e){arguments.length>0&&this.init(t,e)}function e(t,e){for(var i=[],s=[],o=1;t>=o;o++){var n=e.indexOf(o)>-1;n?(i.push(s),s=[]):s.push(o)}return s.length>0&&i.push(s),i}function i(t,e,i,s){var o=1!==s,n=-1!==s,h=i.getSpacingBetweenLines(),r=i.getNumLines(),a=[];return e.forEach(function(e){var d=e.indexOf(r)>-1,u=e.indexOf(1)>-1;if(!(o&&u||n&&d)){1===e.length&&e.push(e[0]);var l=[];e.forEach(function(e,o,n){var a=1===e,d=e===r,u=i.getYForLine(e-1);0!==o||a?o!==n.length-1||d||(u+=h/2-1):u-=h/2-1,l.push(u),1===s&&a?l.push(t-2):-1===s&&d&&l.push(t+2)}),a.push(l.sort(function(t,e){return t-e}))}}),a}var s=Vex.Flow.Stem;return Vex.Inherit(t,Vex.Flow.StemmableNote,{init:function(t,e){var i=Vex.Flow.TabNote.superclass;if(i.init.call(this,t),this.ghost=!1,this.positions=t.positions,Vex.Merge(this.render_options,{glyph_font_scale:30,draw_stem:e,draw_dots:e,draw_stem_through_stave:!1}),this.glyph=Vex.Flow.durationToGlyph(this.duration,this.noteType),!this.glyph)throw new Vex.RuntimeError("BadArguments","Invalid note initialization data (No glyph found): "+JSON.stringify(t));this.buildStem(),this.setStemDirection(t.stem_direction?t.stem_direction:s.UP),this.ghost=!1,this.updateWidth()},getCategory:function(){return"tabnotes"},setGhost:function(t){return this.ghost=t,this.updateWidth(),this},hasStem:function(){return this.render_options.draw_stem},getStemExtension:function(){var t=this.getGlyph();return null!=this.stem_extension_override?this.stem_extension_override:t?1===this.getStemDirection()?t.tabnote_stem_up_extension:t.tabnote_stem_down_extension:0},addDot:function(){var t=new Vex.Flow.Dot;return this.dots++,this.addModifier(t,0)},updateWidth:function(){this.glyphs=[],this.width=0;for(var t=0;t<this.positions.length;++t){var e=this.positions[t].fret;this.ghost&&(e="("+e+")");var i=Vex.Flow.tabToGlyph(e);this.glyphs.push(i),this.width=i.width>this.width?i.width:this.width}},setStave:function(t){var e=Vex.Flow.TabNote.superclass;e.setStave.call(this,t),this.context=t.context,this.width=0;var i;if(this.context)for(i=0;i<this.glyphs.length;++i){var s=""+this.glyphs[i].text;"X"!=s.toUpperCase()&&(this.glyphs[i].width=this.context.measureText(s).width),this.width=this.glyphs[i].width>this.width?this.glyphs[i].width:this.width}var o=[];for(i=0;i<this.positions.length;++i){var n=this.positions[i].str;o.push(this.stave.getYForLine(n-1))}return this.setYs(o)},getPositions:function(){return this.positions},addToModifierContext:function(t){this.setModifierContext(t);for(var e=0;e<this.modifiers.length;++e)this.modifierContext.addModifier(this.modifiers[e]);return this.modifierContext.addModifier(this),this.preFormatted=!1,this},getTieRightX:function(){var t=this.getAbsoluteX(),e=this.glyph.head_width;return t+=e/2,t+=-this.width/2+this.width+2},getTieLeftX:function(){var t=this.getAbsoluteX(),e=this.glyph.head_width;return t+=e/2,t-=this.width/2+2},getModifierStartXY:function(t,e){if(!this.preFormatted)throw new Vex.RERR("UnformattedNote","Can't call GetModifierStartXY on an unformatted note");if(0===this.ys.length)throw new Vex.RERR("NoYValues","No Y-Values calculated for this note.");var i=0;if(t==Vex.Flow.Modifier.Position.LEFT)i=-2;else if(t==Vex.Flow.Modifier.Position.RIGHT)i=this.width+2;else if(t==Vex.Flow.Modifier.Position.BELOW||t==Vex.Flow.Modifier.Position.ABOVE){var s=this.glyph.head_width;i=s/2}return{x:this.getAbsoluteX()+i,y:this.ys[e]}},getLineForRest:function(){return this.positions[0].str},preFormat:function(){this.preFormatted||(this.modifierContext&&this.modifierContext.preFormat(),this.setPreFormatted(!0))},getStemX:function(){return this.getCenterGlyphX()},getStemY:function(){var t=this.stave.getNumLines(),e=-.5,i=t-.5,o=s.UP===this.stem_direction?e:i;return this.stave.getYForLine(o)},getStemExtents:function(){var t=this.getStemY(),e=t+s.HEIGHT*-this.stem_direction;return{topY:e,baseY:t}},drawFlag:function(){var t=null==this.beam&&this.render_options.draw_stem,e=null==this.beam&&t;if(this.glyph.flag&&e){var i,o=this.getStemX()+1,n=this.getStemY()-this.stem.getHeight();i=this.stem_direction==s.DOWN?this.glyph.code_flag_downstem:this.glyph.code_flag_upstem,Vex.Flow.renderGlyph(this.context,o,n,this.render_options.glyph_font_scale,i)}},drawModifiers:function(){this.modifiers.forEach(function(t){("dots"!==t.getCategory()||this.render_options.draw_dots)&&(t.setContext(this.context),t.draw())},this)},drawStemThrough:function(){var t=this.getStemX(),o=this.getStemY(),n=this.context,h=this.render_options.draw_stem_through_stave,r=this.render_options.draw_stem;if(r&&h){var a=this.stave.getNumLines(),d=this.positions.map(function(t){return t.str}),u=e(a,d),l=i(o,u,this.getStave(),this.getStemDirection());this.beam&&1!==this.getStemDirection()||(t+=s.WIDTH/2),n.save(),n.setLineWidth(s.WIDTH),l.forEach(function(e){n.beginPath(),n.moveTo(t,e[0]),n.lineTo(t,e[e.length-1]),n.stroke(),n.closePath()}),n.restore()}},drawPositions:function(){for(var t,e=this.context,i=this.getAbsoluteX(),s=this.ys,o=0;o<this.positions.length;++o){t=s[o];var n=this.glyphs[o],h=this.glyph.head_width,r=i+h/2-n.width/2;if(e.clearRect(r-2,t-3,n.width+4,6),n.code)Vex.Flow.renderGlyph(e,r,t+5+n.shift_y,this.render_options.glyph_font_scale,n.code);else{var a=n.text.toString();e.fillText(a,r,t+5)}}},draw:function(){if(!this.context)throw new Vex.RERR("NoCanvasContext","Can't draw without a canvas context.");if(!this.stave)throw new Vex.RERR("NoStave","Can't draw without a stave.");if(0===this.ys.length)throw new Vex.RERR("NoYValues","Can't draw note without Y values.");var t=null==this.beam&&this.render_options.draw_stem;this.drawPositions(),this.drawStemThrough();var e=this.getStemX(),i=this.getStemY();t&&this.drawStem({x_begin:e,x_end:e,y_top:i,y_bottom:i,y_extend:0,stem_extension:this.getStemExtension(),stem_direction:this.stem_direction}),this.drawFlag(),this.drawModifiers()}}),t}();Vex.Flow.GhostNote=function(){function t(t){arguments.length>0&&this.init(t)}return Vex.Inherit(t,Vex.Flow.StemmableNote,{init:function(i){if(!i)throw new Vex.RuntimeError("BadArguments","Ghost note must have valid initialization data to identify duration.");var e;if("string"==typeof i)e={duration:i};else{if("object"!=typeof i)throw new Vex.RuntimeError("BadArguments","Ghost note must have valid initialization data to identify duration.");e=i}t.superclass.init.call(this,e),this.setWidth(0)},isRest:function(){return!0},setStave:function(i){t.superclass.setStave.call(this,i)},addToModifierContext:function(){return this},preFormat:function(){return this.setPreFormatted(!0),this},draw:function(){if(!this.stave)throw new Vex.RERR("NoStave","Can't draw without a stave.");for(var t=0;t<this.modifiers.length;++t){var i=this.modifiers[t];i.setContext(this.context),i.draw()}}}),t}();Vex.Flow.ClefNote=function(){function t(t,e,i){this.init(t,e,i)}return Vex.Inherit(t,Vex.Flow.Note,{init:function(e,i,n){t.superclass.init.call(this,{duration:"b"}),this.setClef(e,i,n),this.ignore_ticks=!0},setClef:function(t,e,i){return this.clef_obj=new Vex.Flow.Clef(t,e,i),this.clef=this.clef_obj.clef,this.glyph=new Vex.Flow.Glyph(this.clef.code,this.clef.point),this.setWidth(this.glyph.getMetrics().width),this},getClef:function(){return this.clef},setStave:function(t){var e=Vex.Flow.ClefNote.superclass;e.setStave.call(this,t)},getBoundingBox:function(){return new Vex.Flow.BoundingBox(0,0,0,0)},addToModifierContext:function(){return this},getCategory:function(){return"clefnote"},preFormat:function(){return this.setPreFormatted(!0),this},draw:function(){if(!this.stave)throw new Vex.RERR("NoStave","Can't draw without a stave.");this.glyph.getContext()||this.glyph.setContext(this.context);var t=this.getAbsoluteX();if(this.glyph.setStave(this.stave),this.glyph.setYShift(this.stave.getYForLine(this.clef.line)-this.stave.getYForGlyphs()),this.glyph.renderToStave(t),void 0!==this.clef_obj.annotation){var e=new Vex.Flow.Glyph(this.clef_obj.annotation.code,this.clef_obj.annotation.point);e.getContext()||e.setContext(this.context),e.setStave(this.stave),e.setYShift(this.stave.getYForLine(this.clef_obj.annotation.line)-this.stave.getYForGlyphs()),e.setXShift(this.clef_obj.annotation.x_shift),e.renderToStave(t)}}}),t}();Vex.Flow.TimeSigNote=function(){function t(t,i){arguments.length>0&&this.init(t,i)}return Vex.Inherit(t,Vex.Flow.Note,{init:function(i,e){t.superclass.init.call(this,{duration:"b"});var s=new Vex.Flow.TimeSignature(i,e);this.timeSig=s.getTimeSig(),this.setWidth(this.timeSig.glyph.getMetrics().width),this.ignore_ticks=!0},setStave:function(t){var i=Vex.Flow.TimeSigNote.superclass;i.setStave.call(this,t)},getBoundingBox:function(){return new Vex.Flow.BoundingBox(0,0,0,0)},addToModifierContext:function(){return this},preFormat:function(){return this.setPreFormatted(!0),this},draw:function(){if(!this.stave)throw new Vex.RERR("NoStave","Can't draw without a stave.");this.timeSig.glyph.getContext()||this.timeSig.glyph.setContext(this.context),this.timeSig.glyph.setStave(this.stave),this.timeSig.glyph.setYShift(this.stave.getYForLine(this.timeSig.line)-this.stave.getYForGlyphs()),this.timeSig.glyph.renderToStave(this.getAbsoluteX())}}),t}();Vex.Flow.Beam=function(){function t(t,e){arguments.length>0&&this.init(t,e)}function e(t){var e=0;return t.forEach(function(t){t.keyProps&&t.keyProps.forEach(function(t){e+=t.line-3})}),e>=0?n.DOWN:n.UP}var n=Vex.Flow.Stem;return t.prototype={init:function(t,i){if(!t||t==[])throw new Vex.RuntimeError("BadArguments","No notes provided for beam.");if(1==t.length)throw new Vex.RuntimeError("BadArguments","Too few notes for beam.");if(this.ticks=t[0].getIntrinsicTicks(),this.ticks>=Vex.Flow.durationToTicks("4"))throw new Vex.RuntimeError("BadArguments","Beams can only be applied to notes shorter than a quarter note.");var s,o;for(this.stem_direction=n.UP,s=0;s<t.length;++s)if(o=t[s],o.hasStem()){this.stem_direction=o.getStemDirection();break}var r=this.stem_direction;if(i&&"stavenotes"===t[0].getCategory())r=e(t);else if(i&&"tabnotes"===t[0].getCategory()){var a=t.reduce(function(t,e){return t+e.stem_direction},0);r=a>-1?n.UP:n.DOWN}for(s=0;s<t.length;++s)o=t[s],i&&(o.setStemDirection(r),this.stem_direction=r),o.setBeam(this);this.postFormatted=!1,this.notes=t,this.beam_count=this.getBeamCount(),this.break_on_indices=[],this.render_options={beam_width:5,max_slope:.25,min_slope:-.25,slope_iterations:20,slope_cost:100,show_stemlets:!1,stemlet_extension:7,partial_beam_length:10}},setContext:function(t){return this.context=t,this},getNotes:function(){return this.notes},getBeamCount:function(){var t=this.notes.map(function(t){return t.getGlyph().beam_count}),e=t.reduce(function(t,e){return e>t?e:t});return e},breakSecondaryAt:function(t){return this.break_on_indices=t,this},getSlopeY:function(t,e,n,i){return n+(t-e)*i},calculateSlope:function(){for(var t=this.notes[0],e=t.getStemExtents().topY,n=t.getStemX(),i=(this.render_options.max_slope-this.render_options.min_slope)/this.render_options.slope_iterations,s=Number.MAX_VALUE,o=0,r=0,a=this.render_options.min_slope;a<=this.render_options.max_slope;a+=i){for(var h=0,c=0,u=1;u<this.notes.length;++u){var m=this.notes[u],l=m.getStemX(),f=m.getStemExtents().topY,p=this.getSlopeY(l,n,e,a)+c;if(f*this.stem_direction<p*this.stem_direction){var _=Math.abs(f-p);c+=_*-this.stem_direction,h+=_*u}else h+=(f-p)*this.stem_direction}var d=this.notes[this.notes.length-1],g=(d.getStemExtents().topY-e)/(d.getStemX()-n),x=g/2,w=Math.abs(x-a),v=this.render_options.slope_cost*w+Math.abs(h);s>v&&(s=v,o=a,r=c)}this.slope=o,this.y_shift=r},applyStemExtensions:function(){for(var t=this.notes[0],e=t.getStemExtents().topY,i=t.getStemX(),s=0;s<this.notes.length;++s){var o=this.notes[s],r=o.getStemX(),a=o.getStemExtents(),h=a.baseY,c=a.topY;h+=this.stem_direction*o.glyph.stem_offset;var u=Vex.Flow.STEM_WIDTH;if(o.hasStem()){var m=this.getSlopeY(r,i,e,this.slope)+this.y_shift;o.setStem(new Vex.Flow.Stem({x_begin:r-Vex.Flow.STEM_WIDTH/2,x_end:r,y_top:1===this.stem_direction?c:h,y_bottom:1===this.stem_direction?h:c,y_extend:u,stem_extension:Math.abs(c-m)-n.HEIGHT-1,stem_direction:this.stem_direction}))}else if(o.isRest()&&this.render_options.show_stemlets){var l=o.getCenterGlyphX(),f=this.render_options.beam_width,p=(this.beam_count-1)*f*1.5+f,_=p-u+this.render_options.stemlet_extension,d=this.getSlopeY(l,i,e,this.slope)+this.y_shift,g=d+Vex.Flow.Stem.HEIGHT*this.stem_direction,x=d+_*this.stem_direction;o.setStem(new Vex.Flow.Stem({x_begin:l,x_end:l,y_bottom:1===this.stem_direction?x:g,y_top:1===this.stem_direction?g:x,y_extend:u,stem_extension:-1,stem_direction:this.stem_direction}))}}},getBeamLines:function(t){function e(e,n){var i=0;n&&e&&(i=e.getBeamCount()-n.getBeamCount());var s="8"!==t&&i>0,o="8"!==t&&0>i;return{left:s,right:o}}for(var n,i=[],s=!1,o=this.render_options.partial_beam_length,r=0;r<this.notes.length;++r){var a=this.notes[r],h=this.notes[r-1],c=this.notes[r+1],u=a.getIntrinsicTicks(),m=e(h,c),l=a.isRest()?a.getCenterGlyphX():a.getStemX();if(u<Vex.Flow.durationToTicks(t))if(s){n=i[i.length-1],n.end=l;var f=-1!==this.break_on_indices.indexOf(r),p=parseInt(t,10)>=8;f&&p&&(s=!1)}else{var _={start:l,end:null};m.left&&(_.end=l-o),i.push(_),s=!0}else s&&(n=i[i.length-1],null==n.end&&(n.end=n.start+o)),s=!1}return s===!0&&(n=i[i.length-1],null==n.end&&(n.end=n.start-o)),i},drawStems:function(){this.notes.forEach(function(t){t.getStem()&&t.getStem().setContext(this.context).draw()},this)},drawBeamLines:function(){if(!this.context)throw new Vex.RERR("NoCanvasContext","Can't draw without a canvas context.");for(var t=["4","8","16","32","64"],e=this.notes[0],i=this.notes[this.notes.length-1],s=e.getStemExtents().topY,o=i.getStemExtents().topY,r=e.getStemX(),a=this.render_options.beam_width*this.stem_direction,h=0;h<t.length;++h){for(var c=t[h],u=this.getBeamLines(c),m=0;m<u.length;++m){var l=u[m],f=l.start-(this.stem_direction==n.DOWN?Vex.Flow.STEM_WIDTH/2:0),p=this.getSlopeY(f,r,s,this.slope),_=l.end+(1==this.stem_direction?Vex.Flow.STEM_WIDTH/3:-Vex.Flow.STEM_WIDTH/3),d=this.getSlopeY(_,r,s,this.slope);this.context.beginPath(),this.context.moveTo(f,p+this.y_shift),this.context.lineTo(f,p+a+this.y_shift),this.context.lineTo(_+1,d+a+this.y_shift),this.context.lineTo(_+1,d+this.y_shift),this.context.closePath(),this.context.fill()}s+=1.5*a,o+=1.5*a}},preFormat:function(){return this},postFormat:function(){this.postFormatted||(this.calculateSlope(),this.applyStemExtensions(),this.postFormatted=!0)},draw:function(){if(!this.context)throw new Vex.RERR("NoCanvasContext","Can't draw without a canvas context.");if(!this.unbeamable)return this.postFormatted||this.postFormat(),this.drawStems(),this.drawBeamLines(),!0}},t.getDefaultBeamGroups=function(t){t&&"c"!=t||(t="4/4");var e={"1/2":["1/2"],"2/2":["1/2"],"3/2":["1/2"],"4/2":["1/2"],"1/4":["1/4"],"2/4":["1/4"],"3/4":["1/4"],"4/4":["1/4"],"1/8":["1/8"],"2/8":["2/8"],"3/8":["3/8"],"4/8":["2/8"],"1/16":["1/16"],"2/16":["2/16"],"3/16":["3/16"],"4/16":["2/16"]},n=Vex.Flow.Fraction,i=e[t];if(i)return i.map(function(t){return(new n).parse(t)});var s=parseInt(t.split("/")[0],10),o=parseInt(t.split("/")[1],10),r=s%3===0;return r?[new n(3,o)]:o>4?[new n(2,o)]:4>=o?[new n(1,o)]:void 0},t.applyAndGetBeams=function(e,n,i){return t.generateBeams(e.getTickables(),{groups:i,stem_direction:n})},t.generateBeams=function(t,i){function s(t){return t.reduce(function(t,e){return e.getTicks().clone().add(t)},new Vex.Flow.Fraction(0,1))}function o(){f.length-1>_?_+=1:_=0}function r(){var t=[];p.forEach(function(e){if(t=[],e.shouldIgnoreTicks())return d.push(g),void(g=t);g.push(e);var n=f[_].clone(),i=s(g),r=Vex.Flow.durationToNumber(e.duration)<8;r&&e.tuplet&&(n.numerator*=2),i.greaterThan(n)?(r||t.push(g.pop()),d.push(g),g=t,o()):i.equals(n)&&(d.push(g),g=t,o())}),g.length>0&&d.push(g)}function a(){return d.filter(function(t){if(t.length>1){var e=!0;return t.forEach(function(t){t.getIntrinsicTicks()>=Vex.Flow.durationToTicks("4")&&(e=!1)}),e}return!1})}function h(){var t=[];d.forEach(function(e){var n=[];e.forEach(function(e,s,o){var r=0===s||s===o.length-1,a=o[s-1],h=!i.beam_rests&&e.isRest(),c=i.beam_rests&&i.beam_middle_only&&e.isRest()&&r,u=!1;if(i.maintain_stem_directions&&a&&!e.isRest()&&!a.isRest()){var m=a.getStemDirection(),l=e.getStemDirection();u=l!==m}var f=parseInt(e.duration,10)<8,p=h||c||u||f;p?(n.length>0&&t.push(n),n=u?[e]:[]):n.push(e)}),n.length>0&&t.push(n)}),d=t}function c(){d.forEach(function(t){var s;if(i.maintain_stem_directions){var o=u(t);s=o?o.getStemDirection():n.UP}else s=i.stem_direction?i.stem_direction:e(t);m(t,s)})}function u(t){for(var e=0;e<t.length;e++){var n=t[e];if(!n.isRest())return n}return!1}function m(t,e){t.forEach(function(t){t.setStemDirection(e)})}function l(){return d.filter(function(t){return t[0]?t[0].tuplet:void 0})}i||(i={}),i.groups&&i.groups.length||(i.groups=[new Vex.Flow.Fraction(2,8)]);var f=i.groups.map(function(t){if(!t.multiply)throw new Vex.RuntimeError("InvalidBeamGroups","The beam groups must be an array of Vex.Flow.Fractions");return t.clone().multiply(Vex.Flow.RESOLUTION,1)}),p=t,_=0,d=[],g=[];r(),h(),c();var x=a(),w=l(),v=[];return x.forEach(function(t){var e=new Vex.Flow.Beam(t);i.show_stemlets&&(e.render_options.show_stemlets=!0),v.push(e)}),w.forEach(function(t){for(var e=t[0],i=0;i<t.length;++i)if(t[i].hasStem()){e=t[i];break}var s=e.tuplet;e.beam&&s.setBracketed(!1),e.stem_direction==n.DOWN&&s.setTupletLocation(Vex.Flow.Tuplet.LOCATION_BOTTOM)}),v},t}();Vex.Flow.Voice=function(){function t(t){arguments.length>0&&this.init(t)}return t.Mode={STRICT:1,SOFT:2,FULL:3},t.prototype={init:function(t){this.time=Vex.Merge({num_beats:4,beat_value:4,resolution:Vex.Flow.RESOLUTION},t),this.totalTicks=new Vex.Flow.Fraction(this.time.num_beats*(this.time.resolution/this.time.beat_value),1),this.resolutionMultiplier=1,this.tickables=[],this.ticksUsed=new Vex.Flow.Fraction(0,1),this.smallestTickCount=this.totalTicks.clone(),this.largestTickWidth=0,this.stave=null,this.boundingBox=null,this.mode=Vex.Flow.Voice.Mode.STRICT,this.voiceGroup=null},getTotalTicks:function(){return this.totalTicks},getTicksUsed:function(){return this.ticksUsed},getLargestTickWidth:function(){return this.largestTickWidth},getSmallestTickCount:function(){return this.smallestTickCount},getTickables:function(){return this.tickables},getMode:function(){return this.mode},setMode:function(t){return this.mode=t,this},getResolutionMultiplier:function(){return this.resolutionMultiplier},getActualResolution:function(){return this.resolutionMultiplier*this.time.resolution},setStave:function(t){return this.stave=t,this.boundingBox=null,this},getBoundingBox:function(){if(!this.boundingBox){if(!this.stave)throw Vex.RERR("NoStave","Can't get bounding box without stave.");var t=this.stave,i=null;this.tickables[0]&&(this.tickables[0].setStave(t),i=this.tickables[0].getBoundingBox());for(var e=0;e<this.tickables.length;++e)if(this.tickables[e].setStave(t),e>0&&i){var o=this.tickables[e].getBoundingBox();o&&i.mergeWith(o)}this.boundingBox=i}return this.boundingBox},getVoiceGroup:function(){if(!this.voiceGroup)throw new Vex.RERR("NoVoiceGroup","No voice group for voice.");return this.voiceGroup},setVoiceGroup:function(t){return this.voiceGroup=t,this},setStrict:function(t){return this.mode=t?Vex.Flow.Voice.Mode.STRICT:Vex.Flow.Voice.Mode.SOFT,this},isComplete:function(){return this.mode==Vex.Flow.Voice.Mode.STRICT||this.mode==Vex.Flow.Voice.Mode.FULL?this.ticksUsed.equals(this.totalTicks):!0},addTickable:function(t){if(!t.shouldIgnoreTicks()){var i=t.getTicks();if(this.ticksUsed.add(i),(this.mode==Vex.Flow.Voice.Mode.STRICT||this.mode==Vex.Flow.Voice.Mode.FULL)&&this.ticksUsed.greaterThan(this.totalTicks))throw this.totalTicks.subtract(i),new Vex.RERR("BadArgument","Too many ticks.");i.lessThan(this.smallestTickCount)&&(this.smallestTickCount=i.clone()),this.resolutionMultiplier=this.ticksUsed.denominator,this.totalTicks.add(0,this.ticksUsed.denominator)}return this.tickables.push(t),t.setVoice(this),this},addTickables:function(t){for(var i=0;i<t.length;++i)this.addTickable(t[i]);return this},preFormat:function(){return this.preFormatted?void 0:(this.tickables.forEach(function(t){t.getStave()||t.setStave(this.stave)},this),this.preFormatted=!0,this)},draw:function(t,i){for(var e=null,o=0;o<this.tickables.length;++o){var s=this.tickables[o];if(i&&s.setStave(i),!s.getStave())throw new Vex.RuntimeError("MissingStave","The voice cannot draw tickables without staves.");if(0===o&&(e=s.getBoundingBox()),o>0&&e){var n=s.getBoundingBox();n&&e.mergeWith(n)}s.setContext(t),s.draw()}this.boundingBox=e}},t}();Vex.Flow.VoiceGroup=function(){function i(){this.init()}return i.prototype={init:function(){this.voices=[],this.modifierContexts=[]},getVoices:function(){return this.voices},getModifierContexts:function(){return this.modifierContexts},addVoice:function(i){if(!i)throw new Vex.RERR("BadArguments","Voice cannot be null.");this.voices.push(i),i.setVoiceGroup(this)}},i}();Vex.Flow.Modifier=function(){function t(){this.constructor=t,this.init()}function i(){t.DEBUG&&Vex.L("Vex.Flow.Modifier",arguments)}return t.CATEGORY="none",t.Position={LEFT:1,RIGHT:2,ABOVE:3,BELOW:4},t.prototype={init:function(){this.width=0,this.context=null,this.note=null,this.index=null,this.text_line=0,this.position=t.Position.LEFT,this.modifier_context=null,this.x_shift=0,this.y_shift=0,i("Created new modifier")},getCategory:function(){return this.constructor.CATEGORY},getWidth:function(){return this.width},setWidth:function(t){return this.width=t,this},getNote:function(){return this.note},setNote:function(t){return this.note=t,this},getIndex:function(){return this.index},setIndex:function(t){return this.index=t,this},getContext:function(){return this.context},setContext:function(t){return this.context=t,this},getModifierContext:function(){return this.modifier_context},setModifierContext:function(t){return this.modifier_context=t,this},getPosition:function(){return this.position},setPosition:function(t){return this.position=t,this},setTextLine:function(t){return this.text_line=t,this},setYShift:function(t){return this.y_shift=t,this},setXShift:function(i){this.x_shift=0,this.position==t.Position.LEFT?this.x_shift-=i:this.x_shift+=i},draw:function(){if(!this.context)throw new Vex.RERR("NoCanvasContext","Can't draw without a canvas context.");throw new Vex.RERR("MethodNotImplemented","Draw() not implemented for this modifier.")}},t}();Vex.Flow.ModifierContext=function(){function t(){this.modifiers={},this.preFormatted=!1,this.postFormatted=!1,this.width=0,this.spacing=0,this.state={left_shift:0,right_shift:0,text_line:0},this.PREFORMAT=[Vex.Flow.StaveNote,Vex.Flow.Dot,Vex.Flow.FretHandFinger,Vex.Flow.Accidental,Vex.Flow.GraceNoteGroup,Vex.Flow.Stroke,Vex.Flow.StringNumber,Vex.Flow.Articulation,Vex.Flow.Ornament,Vex.Flow.Annotation,Vex.Flow.Bend,Vex.Flow.Vibrato],this.POSTFORMAT=[Vex.Flow.StaveNote]}function i(){t.DEBUG&&Vex.L("Vex.Flow.ModifierContext",arguments)}return t.prototype={addModifier:function(t){var i=t.getCategory();return this.modifiers[i]||(this.modifiers[i]=[]),this.modifiers[i].push(t),t.setModifierContext(this),this.preFormatted=!1,this},getModifiers:function(t){return this.modifiers[t]},getWidth:function(){return this.width},getExtraLeftPx:function(){return this.state.left_shift},getExtraRightPx:function(){return this.state.right_shift},getState:function(){return this.state},getMetrics:function(){if(!this.formatted)throw new Vex.RERR("UnformattedModifier","Unformatted modifier has no metrics.");return{width:this.state.left_shift+this.state.right_shift+this.spacing,spacing:this.spacing,extra_left_px:this.state.left_shift,extra_right_px:this.state.right_shift}},preFormat:function(){this.preFormatted||(this.PREFORMAT.forEach(function(t){i("Preformatting ModifierContext: ",t.CATEGORY),t.format(this.getModifiers(t.CATEGORY),this.state,this)},this),this.width=this.state.left_shift+this.state.right_shift,this.preFormatted=!0)},postFormat:function(){this.postFormatted||this.POSTFORMAT.forEach(function(t){i("Postformatting ModifierContext: ",t.CATEGORY),t.postFormat(this.getModifiers(t.CATEGORY),this)},this)}},t}();Vex.Flow.Accidental=function(){function t(t){arguments.length>0&&this.init(t)}function e(){t.DEBUG&&Vex.L("Vex.Flow.Accidental",arguments)}t.CATEGORY="accidentals";var i=Vex.Flow.Modifier;return t.format=function(e,i){var n=i.left_shift,a=2;if(!e||0===e.length)return!1;var o,s,r,h=[],c=!1,l=null,d=0;for(o=0;o<e.length;++o){s=e[o];var f=s.getNote(),u=f.getStave(),p=f.getKeyProps()[s.getIndex()];if(f!=l){for(var w=0;w<f.keys.length;++w)r=f.getKeyProps()[w],d=r.displaced?f.getExtraLeftPx():d;l=f}if(null!=u){c=!0;var x=u.options.spacing_between_lines_px,g=u.getYForLine(p.line);h.push({y:g,shift:d,acc:s,lineSpace:x})}else h.push({line:p.line,shift:d,acc:s})}if(c)return t.formatByY(h,i);h.sort(function(t,e){return e.line-t.line});var _=h[0].shift,y=0,v=h[0].line;for(o=0;o<h.length;++o){s=h[o].acc;var V=h[o].line,F=h[o].shift;v-3>V&&(v=V,_=F),s.setXShift(n+_),_+=s.getWidth()+a,y=_>y?_:y}i.left_shift+=y},t.formatByY=function(t,e){var i=e.left_shift,n=2;t.sort(function(t,e){return e.y-t.y});for(var a=t[0].shift,o=0,s=t[0].y,r=0;r<t.length;++r){var h=t[r].acc,c=t[r].y,l=t[r].shift;s-c>3*t[r].lineSpace&&(s=c,a=l),h.setXShift(a+i),a+=h.getWidth()+n,o=a>o?a:o}e.left_shift+=o},Vex.Inherit(t,i,{init:function(n){if(t.superclass.init.call(this),e("New accidental: ",n),this.note=null,this.index=null,this.type=n,this.position=i.Position.LEFT,this.render_options={font_scale:38,stroke_px:3},this.accidental=Vex.Flow.accidentalCodes(this.type),!this.accidental)throw new Vex.RERR("ArgumentError","Unknown accidental type: "+n);this.cautionary=!1,this.paren_left=null,this.paren_right=null,this.setWidth(this.accidental.width)},setNote:function(t){if(!t)throw new Vex.RERR("ArgumentError","Bad note value: "+t);this.note=t,"gracenotes"===this.note.getCategory()&&(this.render_options.font_scale=25,this.setWidth(this.accidental.gracenote_width))},setAsCautionary:function(){this.cautionary=!0,this.render_options.font_scale=28,this.paren_left=Vex.Flow.accidentalCodes("{"),this.paren_right=Vex.Flow.accidentalCodes("}");var t="##"==this.type||"bb"==this.type?6:4;return this.setWidth(this.paren_left.width+this.accidental.width+this.paren_right.width-t),this},draw:function(){if(!this.context)throw new Vex.RERR("NoContext","Can't draw accidental without a context.");if(!this.note||null==this.index)throw new Vex.RERR("NoAttachedNote","Can't draw accidental without a note and index.");var t=this.note.getModifierStartXY(this.position,this.index),i=t.x+this.x_shift-this.width,n=t.y+this.y_shift;e("Rendering: ",this.type,i,n),this.cautionary?(i+=3,Vex.Flow.renderGlyph(this.context,i,n,this.render_options.font_scale,this.paren_left.code),i+=2,Vex.Flow.renderGlyph(this.context,i,n,this.render_options.font_scale,this.accidental.code),i+=this.accidental.width-2,("##"==this.type||"bb"==this.type)&&(i-=2),Vex.Flow.renderGlyph(this.context,i,n,this.render_options.font_scale,this.paren_right.code)):Vex.Flow.renderGlyph(this.context,i,n,this.render_options.font_scale,this.accidental.code)}}),t.applyAccidentals=function(t,e){var i=[],n={};t.forEach(function(t){var e=new Vex.Flow.Fraction(0,1),a=t.getTickables();a.forEach(function(t){var a=n[e.value()];a?a.push(t):(i.push(e.value()),n[e.value()]=[t]),e.add(t.getTicks())})});var a=new Vex.Flow.Music;e||(e="C");var o=a.createScaleMap(e);i.forEach(function(t){var e=n[t],i=[];e.forEach(function(t){t.isRest()||t.keys.forEach(function(e,n){var s=a.getNoteParts(e.split("/")[0]),r=s.accidental||"n",h=s.root+r,c=o[s.root]===h,l=i.indexOf(h)>-1;if(!c||c&&l){o[s.root]=h;var d=new Vex.Flow.Accidental(r);t.addAccidental(n,d),i.push(h)}})})})},t}();Vex.Flow.Dot=function(){function t(){this.init()}t.CATEGORY="dots";var i=Vex.Flow.Modifier;return t.format=function(t,i){var e=i.right_shift,n=1;if(!t||0===t.length)return!1;var s,o,h,r,a=[];for(s=0;s<t.length;++s){o=t[s],h=o.getNote();var l;"function"==typeof h.getKeyProps?(l=h.getKeyProps()[o.getIndex()],r=l.displaced?h.getExtraRightPx():0):(l={line:.5},r=0),a.push({line:l.line,shift:r,note:h,dot:o})}a.sort(function(t,i){return i.line-t.line});var d=e,f=0,u=null,g=null,x=null,c=0;for(s=0;s<a.length;++s){o=a[s].dot,h=a[s].note,r=a[s].shift;var w=a[s].line;(w!=u||h!=g)&&(d=r),h.isRest()||w==u||(.5==Math.abs(w%1)?c=0:h.isRest()||(c=.5,null==g||g.isRest()||u-w!=.5?w+c==x&&(c=-.5):c=-.5)),o.dot_shiftY+=-c,x=w+c,o.setXShift(d),d+=o.getWidth()+n,f=d>f?d:f,u=w,g=h}i.right_shift+=f},Vex.Inherit(t,i,{init:function(){t.superclass.init.call(this),this.note=null,this.index=null,this.position=i.Position.RIGHT,this.radius=2,this.setWidth(5),this.dot_shiftY=0},setNote:function(t){this.note=t,"gracenotes"===this.note.getCategory()&&(this.radius*=.5,this.setWidth(3))},setDotShiftY:function(t){return this.dot_shiftY=t,this},draw:function(){if(!this.context)throw new Vex.RERR("NoContext","Can't draw dot without a context.");if(!this.note||null==this.index)throw new Vex.RERR("NoAttachedNote","Can't draw dot without a note and index.");var t=this.note.stave.options.spacing_between_lines_px,i=this.note.getModifierStartXY(this.position,this.index);"tabnotes"===this.note.getCategory()&&(i.y=this.note.getStemExtents().baseY);var e=i.x+this.x_shift+this.width-this.radius,n=i.y+this.y_shift+this.dot_shiftY*t,s=this.context;s.beginPath(),s.arc(e,n,this.radius,0,2*Math.PI,!1),s.fill()}}),t}();Vex.Flow.Formatter=function(){function t(){this.minTotalWidth=0,this.hasMinTotalWidth=!1,this.pixelsPerTick=0,this.totalTicks=new Vex.Flow.Fraction(0,1),this.tContexts=null,this.mContexts=null}function e(){t.DEBUG&&Vex.L("Vex.Flow.Formatter",arguments)}function i(t,e,i,o){var n=e;for(i++;i<t.length;){if(!t[i].isRest()&&!t[i].shouldIgnoreTicks()){n=t[i].getLineForRest();break}i++}if(o&&e!=n){var a=Vex.Max(e,n),r=Vex.Min(e,n);n=Vex.MidLine(a,r)}return n}function o(t,e,i){if(!t||!t.length)throw new Vex.RERR("BadArgument","No voices to format");var o,n,a=t[0].getTotalTicks(),r={},s=[],l=[],h=1;for(o=0;o<t.length;++o){if(n=t[o],!n.getTotalTicks().equals(a))throw new Vex.RERR("TickMismatch","Voices should have same total note duration in ticks.");if(n.getMode()==Vex.Flow.Voice.Mode.STRICT&&!n.isComplete())throw new Vex.RERR("IncompleteVoice","Voice does not have enough notes.");var c=Vex.Flow.Fraction.LCM(h,n.getResolutionMultiplier());c>h&&(h=c)}for(o=0;o<t.length;++o){n=t[o];for(var u=n.getTickables(),f=new Vex.Flow.Fraction(0,h),x=0;x<u.length;++x){var d=u[x],g=f.numerator;if(!r[g]){var T=new e;l.push(T),r[g]=T}i(d,r[g]),s.push(g),f.add(d.getTicks())}}return{map:r,array:l,list:Vex.SortAndUnique(s,function(t,e){return t-e},function(t,e){return t===e}),resolutionMultiplier:h}}return t.FormatAndDraw=function(e,i,o,n){var a={auto_beam:!1,align_rests:!1};"object"==typeof n?Vex.Merge(a,n):"boolean"==typeof n&&(a.auto_beam=n);var r=new Vex.Flow.Voice(Vex.Flow.TIME4_4).setMode(Vex.Flow.Voice.Mode.SOFT);r.addTickables(o);var s=null;if(a.auto_beam&&(s=Vex.Flow.Beam.applyAndGetBeams(r)),(new t).joinVoices([r],{align_rests:a.align_rests}).formatToStave([r],i,{align_rests:a.align_rests}),r.setStave(i),r.draw(e,i),null!=s)for(var l=0;l<s.length;++l)s[l].setContext(e).draw();return r.getBoundingBox()},t.FormatAndDrawTab=function(e,i,o,n,a,r,s){var l={auto_beam:r,align_rests:!1};"object"==typeof s?Vex.Merge(l,s):"boolean"==typeof s&&(l.auto_beam=s);var h=new Vex.Flow.Voice(Vex.Flow.TIME4_4).setMode(Vex.Flow.Voice.Mode.SOFT);h.addTickables(a);var c=new Vex.Flow.Voice(Vex.Flow.TIME4_4).setMode(Vex.Flow.Voice.Mode.SOFT);c.addTickables(n);var u=null;if(l.auto_beam&&(u=Vex.Flow.Beam.applyAndGetBeams(h)),(new t).joinVoices([h],{align_rests:l.align_rests}).joinVoices([c]).formatToStave([h,c],o,{align_rests:l.align_rests}),h.draw(e,o),c.draw(e,i),null!=u)for(var f=0;f<u.length;++f)u[f].setContext(e).draw();new Vex.Flow.StaveConnector(o,i).setContext(e).draw()},t.AlignRestsToNotes=function(t,e,o){for(var n=0;n<t.length;++n)if(t[n]instanceof Vex.Flow.StaveNote&&t[n].isRest()){var a=t[n];if(a.tuplet&&!o)continue;var r=a.getGlyph().position.toUpperCase();if("R/4"!=r&&"B/4"!=r)continue;if(e||null!=a.beam){var s=a.getKeyProps()[0];if(0===n)s.line=i(t,s.line,n,!1),a.setKeyLine(0,s.line);else if(n>0&&n<t.length){var l;t[n-1].isRest()?(l=t[n-1].getKeyProps()[0].line,s.line=l):(l=t[n-1].getLineForRest(),s.line=i(t,l,n,!0)),a.setKeyLine(0,s.line)}}}return this},t.prototype={alignRests:function(e,i){if(!e||!e.length)throw new Vex.RERR("BadArgument","No voices to format rests");for(var o=0;o<e.length;o++)new t.AlignRestsToNotes(e[o].tickables,i)},preCalculateMinTotalWidth:function(t){if(!this.hasMinTotalWidth){if(!this.tContexts){if(!t)throw new Vex.RERR("BadArgument","'voices' required to run preCalculateMinTotalWidth");this.createTickContexts(t)}var e=this.tContexts,i=e.list,o=e.map;this.minTotalWidth=0;for(var n=0;n<i.length;++n){var a=o[i[n]];a.preFormat(),this.minTotalWidth+=a.getWidth()}return this.hasMinTotalWidth=!0,this.minTotalWidth}},getMinTotalWidth:function(){if(!this.hasMinTotalWidth)throw new Vex.RERR("NoMinTotalWidth","Need to call 'preCalculateMinTotalWidth' or 'preFormat' before calling 'getMinTotalWidth'");return this.minTotalWidth},createModifierContexts:function(t){var e=o(t,Vex.Flow.ModifierContext,function(t,e){t.addToModifierContext(e)});return this.mContexts=e,e},createTickContexts:function(t){var e=o(t,Vex.Flow.TickContext,function(t,e){e.addTickable(t)});return e.array.forEach(function(t){t.tContexts=e.array}),this.totalTicks=t[0].getTicksUsed().clone(),this.tContexts=e,e},preFormat:function(t,e,i,o){var n=this.tContexts,a=n.list,r=n.map;i&&o&&i.forEach(function(t){t.setStave(o),t.preFormat()}),t?this.pixelsPerTick=t/(this.totalTicks.value()*n.resolutionMultiplier):(t=0,this.pixelsPerTick=0);var s=0,l=t/2,h=0,c=0,u=0,f=0,x=null,d=t;this.minTotalWidth=0;var g,T,m;for(g=0;g<a.length;++g){T=a[g],m=r[T],e&&m.setContext(e),m.preFormat();var v=m.getMetrics(),w=m.getWidth();this.minTotalWidth+=w;var V=0,p=w;c=Math.min((T-u)*this.pixelsPerTick,p);var F=s+c;null!=x&&(V=s+f-x.extraLeftPx),F=m.shouldIgnoreTicks()?V+m.getWidth():Math.max(F,V),m.shouldIgnoreTicks()&&t&&(t-=m.getWidth(),this.pixelsPerTick=t/(this.totalTicks.value()*n.resolutionMultiplier));var M=v.extraLeftPx;null!=x&&(h=F-s-(f-x.extraLeftPx)),g>0&&h>0&&(h>=M?M=0:M-=h),F+=M,m.setX(F),m.setPixelsUsed(p),x=v,f=w,u=T,s=F}if(this.hasMinTotalWidth=!0,t>0){var C=d-(s+f),k=C/(this.totalTicks.value()*n.resolutionMultiplier),R=0;for(u=0,g=0;g<a.length;++g){T=a[g],m=r[T],c=(T-u)*k,R+=c,m.setX(m.getX()+R),u=T;var W=m.getCenterAlignedTickables();W.forEach(function(t){t.center_x_shift=l-m.getX()})}}},postFormat:function(){return this.mContexts.list.forEach(function(t){this.mContexts.map[t].postFormat()},this),this.tContexts.list.forEach(function(t){this.tContexts.map[t].postFormat()},this),this},joinVoices:function(t){return this.createModifierContexts(t),this.hasMinTotalWidth=!1,this},format:function(t,e,i){var o={align_rests:!1,context:null,stave:null};return Vex.Merge(o,i),this.alignRests(t,o.align_rests),this.createTickContexts(t),this.preFormat(e,o.context,t,o.stave),o.stave&&this.postFormat(),this},formatToStave:function(t,i,o){var n=i.getNoteEndX()-i.getNoteStartX()-10;e("Formatting voices to width: ",n);var a={context:i.getContext()};return Vex.Merge(a,o),this.format(t,n,a)}},t}();Vex.Flow.StaveTie=function(){function t(t,i){arguments.length>0&&this.init(t,i)}return t.prototype={init:function(t,i){this.notes=t,this.context=null,this.text=i,this.render_options={cp1:8,cp2:12,text_shift_x:0,first_x_shift:0,last_x_shift:0,y_shift:7,tie_spacing:0,font:{family:"Arial",size:10,style:""}},this.font=this.render_options.font,this.setNotes(t)},setContext:function(t){return this.context=t,this},setFont:function(t){return this.font=t,this},setNotes:function(t){if(!t.first_note&&!t.last_note)throw new Vex.RuntimeError("BadArguments","Tie needs to have either first_note or last_note set.");if(t.first_indices||(t.first_indices=[0]),t.last_indices||(t.last_indices=[0]),t.first_indices.length!=t.last_indices.length)throw new Vex.RuntimeError("BadArguments","Tied notes must have similar index sizes");return this.first_note=t.first_note,this.first_indices=t.first_indices,this.last_note=t.last_note,this.last_indices=t.last_indices,this},isPartial:function(){return!this.first_note||!this.last_note},renderTie:function(t){if(0===t.first_ys.length||0===t.last_ys.length)throw new Vex.RERR("BadArguments","No Y-values to render");var i=this.context,e=this.render_options.cp1,s=this.render_options.cp2;Math.abs(t.last_x_px-t.first_x_px)<10&&(e=2,s=8);for(var n=this.render_options.first_x_shift,r=this.render_options.last_x_shift,o=this.render_options.y_shift*t.direction,_=0;_<this.first_indices.length;++_){var h=(t.last_x_px+r+(t.first_x_px+n))/2,a=t.first_ys[this.first_indices[_]]+o,f=t.last_ys[this.last_indices[_]]+o;if(isNaN(a)||isNaN(f))throw new Vex.RERR("BadArguments","Bad indices for tie rendering.");var c=(a+f)/2+e*t.direction,x=(a+f)/2+s*t.direction;i.beginPath(),i.moveTo(t.first_x_px+n,a),i.quadraticCurveTo(h,c,t.last_x_px+r,f),i.quadraticCurveTo(h,x,t.first_x_px+n,a),i.closePath(),i.fill()}},renderText:function(t,i){if(this.text){var e=(t+i)/2;e-=this.context.measureText(this.text).width/2,this.context.save(),this.context.setFont(this.font.family,this.font.size,this.font.style),this.context.fillText(this.text,e+this.render_options.text_shift_x,(this.first_note||this.last_note).getStave().getYForTopText()-1),this.context.restore()}},draw:function(){if(!this.context)throw new Vex.RERR("NoContext","No context to render tie.");var t,i,e,s,n,r=this.first_note,o=this.last_note;return r?(t=r.getTieRightX()+this.render_options.tie_spacing,n=r.getStemDirection(),e=r.getYs()):(t=o.getStave().getTieStartX(),e=o.getYs(),this.first_indices=this.last_indices),o?(i=o.getTieLeftX()+this.render_options.tie_spacing,n=o.getStemDirection(),s=o.getYs()):(i=r.getStave().getTieEndX(),s=r.getYs(),this.last_indices=this.first_indices),this.renderTie({first_x_px:t,last_x_px:i,first_ys:e,last_ys:s,direction:n}),this.renderText(t,i),!0}},t}();Vex.Flow.TabTie=function(){function t(t,e){arguments.length>0&&this.init(t,e)}return t.createHammeron=function(e){return new t(e,"H")},t.createPulloff=function(e){return new t(e,"P")},Vex.Inherit(t,Vex.Flow.StaveTie,{init:function(e,i){t.superclass.init.call(this,e,i),this.render_options.cp1=9,this.render_options.cp2=11,this.render_options.y_shift=3,this.setNotes(e)},draw:function(){if(!this.context)throw new Vex.RERR("NoContext","No context to render tie.");var t,e,i,n,s=this.first_note,r=this.last_note;return s?(t=s.getTieRightX()+this.render_options.tie_spacing,i=s.getYs()):(t=r.getStave().getTieStartX(),i=r.getYs(),this.first_indices=this.last_indices),r?(e=r.getTieLeftX()+this.render_options.tie_spacing,n=r.getYs()):(e=s.getStave().getTieEndX(),n=s.getYs(),this.last_indices=this.first_indices),this.renderTie({first_x_px:t,last_x_px:e,first_ys:i,last_ys:n,direction:-1}),this.renderText(t,e),!0}}),t}();Vex.Flow.TabSlide=function(){function t(t,e){arguments.length>0&&this.init(t,e)}return t.SLIDE_UP=1,t.SLIDE_DOWN=-1,t.createSlideUp=function(e){return new t(e,t.SLIDE_UP)},t.createSlideDown=function(e){return new t(e,t.SLIDE_DOWN)},Vex.Inherit(t,Vex.Flow.TabTie,{init:function(e,i){if(t.superclass.init.call(this,e,"sl."),!i){var n=e.first_note.getPositions()[0].fret,s=e.last_note.getPositions()[0].fret;i=parseInt(n,10)>parseInt(s,10)?t.SLIDE_DOWN:t.SLIDE_UP}this.slide_direction=i,this.render_options.cp1=11,this.render_options.cp2=14,this.render_options.y_shift=.5,this.setFont({font:"Times",size:10,style:"bold italic"}),this.setNotes(e)},renderTie:function(e){if(0===e.first_ys.length||0===e.last_ys.length)throw new Vex.RERR("BadArguments","No Y-values to render");var i=this.context,n=e.first_x_px,s=e.first_ys,r=e.last_x_px,o=this.slide_direction;if(o!=t.SLIDE_UP&&o!=t.SLIDE_DOWN)throw new Vex.RERR("BadSlide","Invalid slide direction");for(var l=0;l<this.first_indices.length;++l){var d=s[this.first_indices[l]]+this.render_options.y_shift;if(isNaN(d))throw new Vex.RERR("BadArguments","Bad indices for slide rendering.");i.beginPath(),i.moveTo(n,d+3*o),i.lineTo(r,d-3*o),i.closePath(),i.stroke()}}}),t}();Vex.Flow.Bend=function(){function t(t,e,i){arguments.length>0&&this.init(t,e,i)}t.CATEGORY="bends",t.UP=0,t.DOWN=1;var e=Vex.Flow.Modifier;return t.format=function(t,e){if(!t||0===t.length)return!1;for(var i=0,n=e.text_line,s=0;s<t.length;++s){var r=t[s];r.setXShift(i),i=r.getWidth(),r.setTextLine(n)}return e.right_shift+=i,e.text_line+=1,!0},Vex.Inherit(t,e,{init:function(e,i,n){var s=Vex.Flow.Bend.superclass;s.init.call(this),this.text=e,this.x_shift=0,this.release=i||!1,this.font="10pt Arial",this.render_options={line_width:1.5,line_style:"#777777",bend_width:8,release_width:8},n?this.phrase=n:(this.phrase=[{type:t.UP,text:this.text}],this.release&&this.phrase.push({type:t.DOWN,text:""})),this.updateWidth()},setXShift:function(t){this.x_shift=t,this.updateWidth()},setFont:function(t){return this.font=t,this},getText:function(){return this.text},updateWidth:function(){function e(t){var e;return e=i.context?i.context.measureText(t).width:Vex.Flow.textWidth(t)}for(var i=this,n=0,s=0;s<this.phrase.length;++s){var r=this.phrase[s];if("width"in r)n+=r.width;else{var h=r.type==t.UP?this.render_options.bend_width:this.render_options.release_width;r.width=Vex.Max(h,e(r.text))+3,r.draw_width=r.width/2,n+=r.width}}return this.setWidth(n+this.x_shift),this},draw:function(){function i(t,e,i,n){var s=t+i,r=e;a.save(),a.beginPath(),a.setLineWidth(x.render_options.line_width),a.setStrokeStyle(x.render_options.line_style),a.setFillStyle(x.render_options.line_style),a.moveTo(t,e),a.quadraticCurveTo(s,r,t+i,n),a.stroke(),a.restore()}function n(t,e,i,n){a.save(),a.beginPath(),a.setLineWidth(x.render_options.line_width),a.setStrokeStyle(x.render_options.line_style),a.setFillStyle(x.render_options.line_style),a.moveTo(t,n),a.quadraticCurveTo(t+i,n,t+i,e),a.stroke(),a.restore()}function s(t,e,i){var n=4,s=i||1;a.beginPath(),a.moveTo(t,e),a.lineTo(t-n,e+n*s),a.lineTo(t+n,e+n*s),a.closePath(),a.fill()}function r(t,e){a.save(),a.setRawFont(x.font);var i=t-a.measureText(e).width/2;a.fillText(e,i,l),a.restore()}if(!this.context)throw new Vex.RERR("NoContext","Can't draw bend without a context.");if(!this.note||null==this.index)throw new Vex.RERR("NoNoteForBend","Can't draw bend without a note or index.");var h=this.note.getModifierStartXY(e.Position.RIGHT,this.index);h.x+=3,h.y+=.5;for(var o=this.x_shift,a=this.context,d=this.note.getStave().getYForTopText(this.text_line)+3,l=this.note.getStave().getYForTopText(this.text_line)-1,x=this,u=null,w=0,f=0;f<this.phrase.length;++f){var _=this.phrase[f];0===f&&(_.draw_width+=o),w=_.draw_width+(u?u.draw_width:0)-(1==f?o:0),_.type==t.UP&&(u&&u.type==t.UP&&s(h.x,d),i(h.x,h.y,w,d)),_.type==t.DOWN&&(u&&u.type==t.UP&&n(h.x,h.y,w,d),u&&u.type==t.DOWN&&(s(h.x,h.y,-1),n(h.x,h.y,w,d)),null==u&&(w=_.draw_width,n(h.x,h.y,w,d))),r(h.x+w,_.text),u=_,u.x=h.x,h.x+=w}u.type==t.UP?s(u.x+w,d):u.type==t.DOWN&&s(u.x+w,h.y,-1)}}),t}();Vex.Flow.Vibrato=function(){function t(){this.init()}t.CATEGORY="vibratos";var i=Vex.Flow.Modifier;return t.format=function(t,i,e){if(!t||0===t.length)return!1;var o=i.text_line,r=0,n=i.right_shift-7,h=e.getModifiers(Vex.Flow.Bend.CATEGORY);h&&h.length>0&&o--;for(var a=0;a<t.length;++a){var s=t[a];s.setXShift(n),s.setTextLine(o),r+=s.getWidth(),n+=r}return i.right_shift+=r,i.text_line+=1,!0},Vex.Inherit(t,i,{init:function(){var t=Vex.Flow.Vibrato.superclass;t.init.call(this),this.harsh=!1,this.position=Vex.Flow.Modifier.Position.RIGHT,this.render_options={vibrato_width:20,wave_height:6,wave_width:4,wave_girth:2},this.setVibratoWidth(this.render_options.vibrato_width)},setHarsh:function(t){return this.harsh=t,this},setVibratoWidth:function(t){return this.vibrato_width=t,this.setWidth(this.vibrato_width),this},draw:function(){function t(t,i){var n=o.render_options.wave_width,h=o.render_options.wave_girth,a=o.render_options.wave_height,s=r/n;e.beginPath();var d;if(o.harsh){for(e.moveTo(t,i+h+1),d=0;s/2>d;++d)e.lineTo(t+n,i-a/2),t+=n,e.lineTo(t+n,i+a/2),t+=n;for(d=0;s/2>d;++d)e.lineTo(t-n,i-a/2+h+1),t-=n,e.lineTo(t-n,i+a/2+h+1),t-=n;e.fill()}else{for(e.moveTo(t,i+h),d=0;s/2>d;++d)e.quadraticCurveTo(t+n/2,i-a/2,t+n,i),t+=n,e.quadraticCurveTo(t+n/2,i+a/2,t+n,i),t+=n;for(d=0;s/2>d;++d)e.quadraticCurveTo(t-n/2,i+a/2+h,t-n,i+h),t-=n,e.quadraticCurveTo(t-n/2,i-a/2+h,t-n,i+h),t-=n;e.fill()}}if(!this.context)throw new Vex.RERR("NoContext","Can't draw vibrato without a context.");if(!this.note)throw new Vex.RERR("NoNoteForVibrato","Can't draw vibrato without an attached note.");var i=this.note.getModifierStartXY(Vex.Flow.Modifier.Position.RIGHT,this.index),e=this.context,o=this,r=this.vibrato_width,n=i.x+this.x_shift,h=this.note.getYForTopText(this.text_line)+2;t(n,h)}}),t}();Vex.Flow.Annotation=function(){function t(t){arguments.length>0&&this.init(t)}function i(){t.DEBUG&&Vex.L("Vex.Flow.Annotation",arguments)}t.CATEGORY="annotations",t.Justify={LEFT:1,CENTER:2,RIGHT:3,CENTER_STEM:4},t.VerticalJustify={TOP:1,CENTER:2,BOTTOM:3,CENTER_STEM:4},t.format=function(t,i){if(!t||0===t.length)return!1;for(var e,n=i.text_line,s=0,o=0;o<t.length;++o){var h=t[o];h.setTextLine(n),e=h.getWidth()>s?h.getWidth():s,n++}return i.left_shift+=e/2,i.right_shift+=e/2,!0};var e=Vex.Flow.Modifier;return Vex.Inherit(t,e,{init:function(i){t.superclass.init.call(this),this.note=null,this.index=null,this.text_line=0,this.text=i,this.justification=t.Justify.CENTER,this.vert_justification=t.VerticalJustify.TOP,this.font={family:"Arial",size:10,weight:""},this.setWidth(Vex.Flow.textWidth(i))},setTextLine:function(t){return this.text_line=t,this},setFont:function(t,i,e){return this.font={family:t,size:i,weight:e},this},setVerticalJustification:function(t){return this.vert_justification=t,this},getJustification:function(){return this.justification},setJustification:function(t){return this.justification=t,this},draw:function(){if(!this.context)throw new Vex.RERR("NoContext","Can't draw text annotation without a context.");if(!this.note)throw new Vex.RERR("NoNoteForAnnotation","Can't draw text annotation without an attached note.");var n=this.note.getModifierStartXY(e.Position.ABOVE,this.index);this.context.save(),this.context.setFont(this.font.family,this.font.size,this.font.weight);var s,o,h=this.context.measureText(this.text).width,a=this.context.measureText("m").width;s=this.justification==t.Justify.LEFT?n.x:this.justification==t.Justify.RIGHT?n.x-h:this.justification==t.Justify.CENTER?n.x-h/2:this.note.getStemX()-h/2;var r,f,u=this.note.hasStem(),x=this.note.getStave();if(u&&(r=this.note.getStem().getExtents(),f=x.getSpacingBetweenLines()),this.vert_justification==t.VerticalJustify.BOTTOM){if(o=x.getYForBottomText(this.text_line),u){var c=1===this.note.getStemDirection()?r.baseY:r.topY;o=Math.max(o,c+f*(this.text_line+2))}}else if(this.vert_justification==t.VerticalJustify.CENTER){var l=this.note.getYForTopText(this.text_line)-1,T=x.getYForBottomText(this.text_line);o=l+(T-l)/2+a/2}else if(this.vert_justification==t.VerticalJustify.TOP)o=Math.min(x.getYForTopText(this.text_line),this.note.getYs()[0]-10),u&&(o=Math.min(o,r.topY-5-f*this.text_line));else{var g=this.note.getStemExtents();o=g.topY+(g.baseY-g.topY)/2+a/2}i("Rendering annotation: ",this.text,s,o),this.context.fillText(this.text,s,o),this.context.restore()}}),t}();Vex.Flow.Articulation=function(){function t(t){arguments.length>0&&this.init(t)}function i(){t.DEBUG&&Vex.L("Vex.Flow.Articulation",arguments)}t.CATEGORY="articulations";var e=Vex.Flow.Modifier;return t.format=function(t,i){if(!t||0===t.length)return!1;for(var e,o=i.text_line,n=0,s=0;s<t.length;++s){var a=t[s];a.setTextLine(o),e=a.getWidth()>n?a.getWidth():n;var r=Vex.Flow.articulationCodes(a.type);o+=r.between_lines?1:1.5}return i.left_shift+=e/2,i.right_shift+=e/2,i.text_line=o,!0},Vex.Inherit(t,e,{init:function(i){if(t.superclass.init.call(this),this.note=null,this.index=null,this.type=i,this.position=e.Position.BELOW,this.render_options={font_scale:38},this.articulation=Vex.Flow.articulationCodes(this.type),!this.articulation)throw new Vex.RERR("ArgumentError","Articulation not found: '"+this.type+"'");this.setWidth(this.articulation.width)},draw:function(){if(!this.context)throw new Vex.RERR("NoContext","Can't draw Articulation without a context.");if(!this.note||null===this.index)throw new Vex.RERR("NoAttachedNote","Can't draw Articulation without a note and index.");var t=this.note.getStemDirection(),o=this.note.getStave(),n=this.position===e.Position.ABOVE&&t===Vex.Flow.StaveNote.STEM_DOWN||this.position===e.Position.BELOW&&t===Vex.Flow.StaveNote.STEM_UP,s=function(t,i,o){var s=t.position===e.Position.ABOVE?1:-1,a=t.getNote().getDuration();!n&&Vex.Flow.durationToNumber(a)<=1&&(i+=3.5*s);var r=i+s*o;return r>=1&&5>=r&&r%1===0?!0:!1},a=this.note.getModifierStartXY(this.position,this.index),r=a.y,h=0,l=1,u=o.getSpacingBetweenLines(),x="tabnotes"===this.note.getCategory(),c=this.note.getStem().getExtents(),g=c.topY,w=c.baseY;t===Vex.Flow.StaveNote.STEM_DOWN&&(g=c.baseY,w=c.topY),x&&(this.note.hasStem()?t===Vex.Flow.StaveNote.STEM_UP?w=o.getYForBottomText(this.text_line-2):t===Vex.Flow.StaveNote.STEM_DOWN&&(g=o.getYForTopText(this.text_line-1.5)):(g=o.getYForTopText(this.text_line-1),w=o.getYForBottomText(this.text_line-2)));var _=this.position===e.Position.ABOVE?!0:!1,d=this.note.getLineNumber(_);!n&&this.note.beam&&(l+=.5),s(this,d,l)&&(l+=.5);var f;this.position===e.Position.ABOVE?(h=this.articulation.shift_up,f=g-7-u*(this.text_line+l),r=this.articulation.between_lines?f:Math.min(o.getYForTopText(this.text_line)-3,f)):(h=this.articulation.shift_down-10,f=w+10+u*(this.text_line+l),r=this.articulation.between_lines?f:Math.max(o.getYForBottomText(this.text_line),f));var p=a.x+this.articulation.shift_right;r+=h+this.y_shift,i("Rendering articulation: ",this.articulation,p,r),Vex.Flow.renderGlyph(this.context,p,r,this.render_options.font_scale,this.articulation.code)}}),t}();Vex.Flow.Tuning=function(){function n(n){this.init(n)}return n.names={standard:"E/5,B/4,G/4,D/4,A/3,E/3",dagdad:"D/5,A/4,G/4,D/4,A/3,D/3",dropd:"E/5,B/4,G/4,D/4,A/3,D/3",eb:"Eb/5,Bb/4,Gb/4,Db/4,Ab/3,Db/3"},n.prototype={init:function(n){this.setTuning(n||"E/5,B/4,G/4,D/4,A/3,E/3,B/2,E/2")},noteToInteger:function(n){return Vex.Flow.keyProperties(n).int_value},setTuning:function(n){Vex.Flow.Tuning.names[n]&&(n=Vex.Flow.Tuning.names[n]),this.tuningString=n,this.tuningValues=[],this.numStrings=0;var t=n.split(/\s*,\s*/);if(0===t.length)throw new Vex.RERR("BadArguments","Invalid tuning string: "+n);this.numStrings=t.length;for(var e=0;e<this.numStrings;++e)this.tuningValues[e]=this.noteToInteger(t[e])},getValueForString:function(n){var t=parseInt(n,10);if(1>t||t>this.numStrings)throw new Vex.RERR("BadArguments","String number must be between 1 and "+this.numStrings+": "+n);return this.tuningValues[t-1]},getValueForFret:function(n,t){var e=this.getValueForString(t),r=parseInt(n,10);if(0>r)throw new Vex.RERR("BadArguments","Fret number must be 0 or higher: "+n);return e+r},getNoteForFret:function(n,t){var e=this.getValueForFret(n,t),r=Math.floor(e/12),i=e%12;return Vex.Flow.integerToNote(i)+"/"+r}},n}();Vex.Flow.StaveModifier=function(){function t(){this.init()}return t.prototype={init:function(){this.padding=10},getCategory:function(){return""},makeSpacer:function(t){return{getContext:function(){return!0},setStave:function(){},renderToStave:function(){},getMetrics:function(){return{width:t}}}},placeGlyphOnLine:function(t,e,i){t.setYShift(e.getYForLine(i)-e.getYForGlyphs())},setPadding:function(t){this.padding=t},addToStave:function(t,e){return e||t.addGlyph(this.makeSpacer(this.padding)),this.addModifier(t),this},addToStaveEnd:function(t,e){return t.addEndGlyph(e?this.makeSpacer(2):this.makeSpacer(this.padding)),this.addEndModifier(t),this},addModifier:function(){throw new Vex.RERR("MethodNotImplemented","addModifier() not implemented for this stave modifier.")},addEndModifier:function(){throw new Vex.RERR("MethodNotImplemented","addEndModifier() not implemented for this stave modifier.")}},t}();Vex.Flow.KeySignature=function(){function t(t){arguments.length>0&&this.init(t)}return t.accidentalSpacing={"#":{above:6,below:4},b:{above:4,below:7},n:{above:3,below:-1}},Vex.Inherit(t,Vex.Flow.StaveModifier,{init:function(e){t.superclass.init(),this.glyphFontScale=38,this.accList=Vex.Flow.keySignature(e)},addAccToStave:function(e,i,c){var a=Vex.Flow.accidentalCodes(i.type),n=new Vex.Flow.Glyph(a.code,this.glyphFontScale),s=0;if("n"===i.type&&c){var h=c.line>=i.line,l=t.accidentalSpacing[c.type];s=h?l.above:l.below}n.setWidth(a.width+s),this.placeGlyphOnLine(n,e,i.line),e.addGlyph(n)},cancelKey:function(t){var e=Vex.Flow.keySignature(t),i=this.accList.length>0&&e[0].type!==this.accList[0].type,c=0;if(c=i?e.length:e.length-this.accList.length,!(1>c)){for(var a=[],n=0;c>n;n++){var s=n;i||(s=e.length-c+n);var h=e[s];a.push({type:"n",line:h.line})}return this.accList=a.concat(this.accList),this}},addModifier:function(t){this.convertAccLines(t.clef,this.accList[0].type);for(var e=0;e<this.accList.length;++e)this.addAccToStave(t,this.accList[e],this.accList[e+1])},addToStave:function(t,e){return 0===this.accList.length?this:(e||t.addGlyph(this.makeSpacer(this.padding)),this.addModifier(t),this)},convertAccLines:function(t,e){var i,c=0,a="tenor"===t&&"#"===e?!0:!1;switch(t){case"bass":c=1;break;case"alto":c=.5;break;case"tenor":a||(c=-.5)}var n;if(a)for(i=[3,1,2.5,.5,2,0,1.5],n=0;n<this.accList.length;++n)this.accList[n].line=i[n];else if("treble"!=t)for(n=0;n<this.accList.length;++n)this.accList[n].line+=c}}),t}();Vex.Flow.TimeSignature=function(){function i(i,t){arguments.length>0&&this.init(i,t)}return i.glyphs={C:{code:"v41",point:40,line:2},"C|":{code:"vb6",point:40,line:2}},Vex.Inherit(i,Vex.Flow.StaveModifier,{init:function(t,e){i.superclass.init();var n=e||15;this.setPadding(n),this.point=40,this.topLine=2,this.bottomLine=4,this.timeSig=this.parseTimeSpec(t)},parseTimeSpec:function(t){if("C"==t||"C|"==t){var e=i.glyphs[t];return{num:!1,line:e.line,glyph:new Vex.Flow.Glyph(e.code,e.point)}}var n,h,s=[];for(n=0;n<t.length&&(h=t.charAt(n),"/"!=h);++n){if(!/[0-9]/.test(h))throw new Vex.RERR("BadTimeSignature","Invalid time spec: "+t);s.push(h)}if(0===n)throw new Vex.RERR("BadTimeSignature","Invalid time spec: "+t);if(++n,n==t.length)throw new Vex.RERR("BadTimeSignature","Invalid time spec: "+t);for(var r=[];n<t.length;++n){if(h=t.charAt(n),!/[0-9]/.test(h))throw new Vex.RERR("BadTimeSignature","Invalid time spec: "+t);r.push(h)}return{num:!0,glyph:this.makeTimeSignatureGlyph(s,r)}},makeTimeSignatureGlyph:function(i,t){var e=new Vex.Flow.Glyph("v0",this.point);e.topGlyphs=[],e.botGlyphs=[];var n,h,s=0;for(n=0;n<i.length;++n){h=i[n];var r=new Vex.Flow.Glyph("v"+h,this.point);e.topGlyphs.push(r),s+=r.getMetrics().width}var l=0;for(n=0;n<t.length;++n){h=t[n];var o=new Vex.Flow.Glyph("v"+h,this.point);e.botGlyphs.push(o),l+=o.getMetrics().width}var p=s>l?s:l,a=e.getMetrics().x_min;e.getMetrics=function(){return{x_min:a,x_max:a+p,width:p}};var g=(p-s)/2,m=(p-l)/2,c=this;return e.renderToStave=function(i){var t,e,n=i+g;for(t=0;t<this.topGlyphs.length;++t)e=this.topGlyphs[t],Vex.Flow.Glyph.renderOutline(this.context,e.metrics.outline,e.scale,n+e.x_shift,this.stave.getYForLine(c.topLine)+1),n+=e.getMetrics().width;for(n=i+m,t=0;t<this.botGlyphs.length;++t)e=this.botGlyphs[t],c.placeGlyphOnLine(e,this.stave,e.line),Vex.Flow.Glyph.renderOutline(this.context,e.metrics.outline,e.scale,n+e.x_shift,this.stave.getYForLine(c.bottomLine)+1),n+=e.getMetrics().width},e},getTimeSig:function(){return this.timeSig},addModifier:function(i){this.timeSig.num||this.placeGlyphOnLine(this.timeSig.glyph,i,this.timeSig.line),i.addGlyph(this.timeSig.glyph)},addEndModifier:function(i){this.timeSig.num||this.placeGlyphOnLine(this.timeSig.glyph,i,this.timeSig.line),i.addEndGlyph(this.timeSig.glyph)}}),i}();Vex.Flow.Clef=function(){function e(e,i,t){arguments.length>0&&this.init(e,i,t)}function i(){Vex.Flow.Clef.DEBUG&&Vex.L("Vex.Flow.Clef",arguments)}return e.types={treble:{code:"v83",line:3},bass:{code:"v79",line:1},alto:{code:"vad",line:2},tenor:{code:"vad",line:1},percussion:{code:"v59",line:2},soprano:{code:"vad",line:4},"mezzo-soprano":{code:"vad",line:3},"baritone-c":{code:"vad",line:0},"baritone-f":{code:"v79",line:2},subbass:{code:"v79",line:0},french:{code:"v83",line:4}},e.sizes={"default":40,small:32},e.annotations={"8va":{code:"v8",sizes:{"default":{point:20,attachments:{treble:{line:-1.2,x_shift:11}}},small:{point:18,attachments:{treble:{line:-.4,x_shift:8}}}}},"8vb":{code:"v8",sizes:{"default":{point:20,attachments:{treble:{line:6.3,x_shift:10},bass:{line:4,x_shift:1}}},small:{point:18,attachments:{treble:{line:5.8,x_shift:6},bass:{line:3.5,x_shift:.5}}}}}},Vex.Inherit(e,Vex.Flow.StaveModifier,{init:function(e,t,n){var s=Vex.Flow.Clef.superclass;if(s.init.call(this),this.clef=Vex.Flow.Clef.types[e],this.size=void 0===t?"default":t,this.clef.point=Vex.Flow.Clef.sizes[this.size],void 0!==n){var o=Vex.Flow.Clef.annotations[n];this.annotation={code:o.code,point:o.sizes[this.size].point,line:o.sizes[this.size].attachments[e].line,x_shift:o.sizes[this.size].attachments[e].x_shift}}i("Creating clef:",e)},addModifier:function(e){var i=new Vex.Flow.Glyph(this.clef.code,this.clef.point);if(this.placeGlyphOnLine(i,e,this.clef.line),void 0!==this.annotation){var t=new Vex.Flow.Glyph(this.annotation.code,this.annotation.point);t.metrics.x_max=0,t.setXShift(this.annotation.x_shift),this.placeGlyphOnLine(t,e,this.annotation.line),e.addGlyph(t)}e.addGlyph(i)},addEndModifier:function(e){var i=new Vex.Flow.Glyph(this.clef.code,this.clef.point);if(this.placeGlyphOnLine(i,e,this.clef.line),e.addEndGlyph(i),void 0!==this.annotation){var t=new Vex.Flow.Glyph(this.annotation.code,this.annotation.point);t.metrics.x_max=0,t.setXShift(this.annotation.x_shift),this.placeGlyphOnLine(t,e,this.annotation.line),e.addEndGlyph(t)}}}),e}();Vex.Flow.Music=function(){function t(){this.init()}return t.NUM_TONES=12,t.roots=["c","d","e","f","g","a","b"],t.root_values=[0,2,4,5,7,9,11],t.root_indices={c:0,d:1,e:2,f:3,g:4,a:5,b:6},t.canonical_notes=["c","c#","d","d#","e","f","f#","g","g#","a","a#","b"],t.diatonic_intervals=["unison","m2","M2","m3","M3","p4","dim5","p5","m6","M6","b7","M7","octave"],t.diatonic_accidentals={unison:{note:0,accidental:0},m2:{note:1,accidental:-1},M2:{note:1,accidental:0},m3:{note:2,accidental:-1},M3:{note:2,accidental:0},p4:{note:3,accidental:0},dim5:{note:4,accidental:-1},p5:{note:4,accidental:0},m6:{note:5,accidental:-1},M6:{note:5,accidental:0},b7:{note:6,accidental:-1},M7:{note:6,accidental:0},octave:{note:7,accidental:0}},t.intervals={u:0,unison:0,m2:1,b2:1,min2:1,S:1,H:1,2:2,M2:2,maj2:2,T:2,W:2,m3:3,b3:3,min3:3,M3:4,3:4,maj3:4,4:5,p4:5,"#4":6,b5:6,aug4:6,dim5:6,5:7,p5:7,"#5":8,b6:8,aug5:8,6:9,M6:9,maj6:9,b7:10,m7:10,min7:10,dom7:10,M7:11,maj7:11,8:12,octave:12},t.scales={major:[2,2,1,2,2,2,1],dorian:[2,1,2,2,2,1,2],mixolydian:[2,2,1,2,2,1,2],minor:[2,1,2,2,1,2,2]},t.accidentals=["bb","b","n","#","##"],t.noteValues={c:{root_index:0,int_val:0},cn:{root_index:0,int_val:0},"c#":{root_index:0,int_val:1},"c##":{root_index:0,int_val:2},cb:{root_index:0,int_val:11},cbb:{root_index:0,int_val:10},d:{root_index:1,int_val:2},dn:{root_index:1,int_val:2},"d#":{root_index:1,int_val:3},"d##":{root_index:1,int_val:4},db:{root_index:1,int_val:1},dbb:{root_index:1,int_val:0},e:{root_index:2,int_val:4},en:{root_index:2,int_val:4},"e#":{root_index:2,int_val:5},"e##":{root_index:2,int_val:6},eb:{root_index:2,int_val:3},ebb:{root_index:2,int_val:2},f:{root_index:3,int_val:5},fn:{root_index:3,int_val:5},"f#":{root_index:3,int_val:6},"f##":{root_index:3,int_val:7},fb:{root_index:3,int_val:4},fbb:{root_index:3,int_val:3},g:{root_index:4,int_val:7},gn:{root_index:4,int_val:7},"g#":{root_index:4,int_val:8},"g##":{root_index:4,int_val:9},gb:{root_index:4,int_val:6},gbb:{root_index:4,int_val:5},a:{root_index:5,int_val:9},an:{root_index:5,int_val:9},"a#":{root_index:5,int_val:10},"a##":{root_index:5,int_val:11},ab:{root_index:5,int_val:8},abb:{root_index:5,int_val:7},b:{root_index:6,int_val:11},bn:{root_index:6,int_val:11},"b#":{root_index:6,int_val:0},"b##":{root_index:6,int_val:1},bb:{root_index:6,int_val:10},bbb:{root_index:6,int_val:9}},t.prototype={init:function(){},isValidNoteValue:function(t){return null==t||0>t||t>=Vex.Flow.Music.NUM_TONES?!1:!0},isValidIntervalValue:function(t){return this.isValidNoteValue(t)},getNoteParts:function(t){if(!t||t.length<1)throw new Vex.RERR("BadArguments","Invalid note name: "+t);if(t.length>3)throw new Vex.RERR("BadArguments","Invalid note name: "+t);var e=t.toLowerCase(),n=/^([cdefgab])(b|bb|n|#|##)?$/,a=n.exec(e);if(null!=a){var i=a[1],o=a[2];return{root:i,accidental:o}}throw new Vex.RERR("BadArguments","Invalid note name: "+t)},getKeyParts:function(t){if(!t||t.length<1)throw new Vex.RERR("BadArguments","Invalid key: "+t);var e=t.toLowerCase(),n=/^([cdefgab])(b|#)?(mel|harm|m|M)?$/,a=n.exec(e);if(null!=a){var i=a[1],o=a[2],r=a[3];return r||(r="M"),{root:i,accidental:o,type:r}}throw new Vex.RERR("BadArguments","Invalid key: "+t)},getNoteValue:function(e){var n=t.noteValues[e];if(null==n)throw new Vex.RERR("BadArguments","Invalid note name: "+e);return n.int_val},getIntervalValue:function(e){var n=t.intervals[e];if(null==n)throw new Vex.RERR("BadArguments","Invalid interval name: "+e);return n},getCanonicalNoteName:function(e){if(!this.isValidNoteValue(e))throw new Vex.RERR("BadArguments","Invalid note value: "+e);return t.canonical_notes[e]},getCanonicalIntervalName:function(e){if(!this.isValidIntervalValue(e))throw new Vex.RERR("BadArguments","Invalid interval value: "+e);return t.diatonic_intervals[e]},getRelativeNoteValue:function(e,n,a){if(null==a&&(a=1),1!=a&&-1!=a)throw new Vex.RERR("BadArguments","Invalid direction: "+a);var i=(e+a*n)%t.NUM_TONES;return 0>i&&(i+=t.NUM_TONES),i},getRelativeNoteName:function(e,n){var a=this.getNoteParts(e),i=this.getNoteValue(a.root),o=n-i;if(Math.abs(o)>t.NUM_TONES-3){var r=1;o>0&&(r=-1);var l=(n+1+(i+1))%t.NUM_TONES*r;if(Math.abs(l)>2)throw new Vex.RERR("BadArguments","Notes not related: "+e+", "+n);o=l}if(Math.abs(o)>2)throw new Vex.RERR("BadArguments","Notes not related: "+e+", "+n);var d,_=a.root;if(o>0)for(d=1;o>=d;++d)_+="#";else if(0>o)for(d=-1;d>=o;--d)_+="b";return _},getScaleTones:function(t,e){var n=[];n.push(t);for(var a=t,i=0;i<e.length;++i)a=this.getRelativeNoteValue(a,e[i]),a!=t&&n.push(a);return n},getIntervalBetween:function(e,n,a){if(null==a&&(a=1),1!=a&&-1!=a)throw new Vex.RERR("BadArguments","Invalid direction: "+a);if(!this.isValidNoteValue(e)||!this.isValidNoteValue(n))throw new Vex.RERR("BadArguments","Invalid notes: "+e+", "+n);var i;return i=1==a?n-e:e-n,0>i&&(i+=t.NUM_TONES),i},createScaleMap:function(t){var e=this.getKeyParts(t),n=Vex.Flow.KeyManager.scales[e.type],a=e.root;if(e.accidental&&(a+=e.accidental),!n)throw new Vex.RERR("BadArguments","Unsupported key type: "+t);for(var i=this.getScaleTones(this.getNoteValue(a),n),o=Vex.Flow.Music.root_indices[e.root],r={},l=0;l<Vex.Flow.Music.roots.length;++l){var d=(o+l)%Vex.Flow.Music.roots.length,_=Vex.Flow.Music.roots[d],c=this.getRelativeNoteName(_,i[l]);1===c.length&&(c+="n"),r[_]=c}return r}},t}();Vex.Flow.KeyManager=function(){function t(t){this.init(t)}return t.scales={M:Vex.Flow.Music.scales.major,m:Vex.Flow.Music.scales.minor},t.prototype={init:function(t){this.music=new Vex.Flow.Music,this.setKey(t)},setKey:function(t){return this.key=t,this.reset(),this},getKey:function(){return this.key},reset:function(){this.keyParts=this.music.getKeyParts(this.key),this.keyString=this.keyParts.root,this.keyParts.accidental&&(this.keyString+=this.keyParts.accidental);var e=t.scales[this.keyParts.type];if(!e)throw new Vex.RERR("BadArguments","Unsupported key type: "+this.key);this.scale=this.music.getScaleTones(this.music.getNoteValue(this.keyString),Vex.Flow.KeyManager.scales[this.keyParts.type]),this.scaleMap={},this.scaleMapByValue={},this.originalScaleMapByValue={};for(var s=Vex.Flow.Music.root_indices[this.keyParts.root],a=0;a<Vex.Flow.Music.roots.length;++a){var i=(s+a)%Vex.Flow.Music.roots.length,c=Vex.Flow.Music.roots[i],l=this.music.getRelativeNoteName(c,this.scale[a]);this.scaleMap[c]=l,this.scaleMapByValue[this.scale[a]]=l,this.originalScaleMapByValue[this.scale[a]]=l}return this},getAccidental:function(t){var e=this.music.getKeyParts(t).root,s=this.music.getNoteParts(this.scaleMap[e]);return{note:this.scaleMap[e],accidental:s.accidental}},selectNote:function(t){t=t.toLowerCase();var e=this.music.getNoteParts(t),s=this.scaleMap[e.root],a=this.music.getNoteParts(s);if(s==t)return{note:s,accidental:e.accidental,change:!1};var i=this.scaleMapByValue[this.music.getNoteValue(t)];if(null!=i)return{note:i,accidental:this.music.getNoteParts(i).accidental,change:!1};var c=this.originalScaleMapByValue[this.music.getNoteValue(t)];return null!=c?(this.scaleMap[a.root]=c,delete this.scaleMapByValue[this.music.getNoteValue(s)],this.scaleMapByValue[this.music.getNoteValue(t)]=c,{note:c,accidental:this.music.getNoteParts(c).accidental,change:!0}):a.root==t?(delete this.scaleMapByValue[this.music.getNoteValue(this.scaleMap[e.root])],this.scaleMapByValue[this.music.getNoteValue(a.root)]=a.root,this.scaleMap[a.root]=a.root,{note:a.root,accidental:null,change:!0}):(delete this.scaleMapByValue[this.music.getNoteValue(this.scaleMap[e.root])],this.scaleMapByValue[this.music.getNoteValue(t)]=t,delete this.scaleMap[a.root],this.scaleMap[a.root]=t,{note:t,accidental:e.accidental,change:!0})}},t}();Vex.Flow.Renderer=function(){function e(e,t){arguments.length>0&&this.init(e,t)}return e.Backends={CANVAS:1,RAPHAEL:2,SVG:3,VML:4},e.LineEndType={NONE:1,UP:2,DOWN:3},e.USE_CANVAS_PROXY=!1,e.buildContext=function(t,n,a,i,o){var s=new e(t,n);a&&i&&s.resize(a,i),o||(o="#eed");var r=s.getContext();return r.setBackgroundFillStyle(o),r},e.getCanvasContext=function(t,n,a,i){return e.buildContext(t,e.Backends.CANVAS,n,a,i)},e.getRaphaelContext=function(t,n,a,i){return e.buildContext(t,e.Backends.RAPHAEL,n,a,i)},e.bolsterCanvasContext=function(t){if(e.USE_CANVAS_PROXY)return new Vex.Flow.CanvasContext(t);var n=["clear","setFont","setRawFont","setFillStyle","setBackgroundFillStyle","setStrokeStyle","setShadowColor","setShadowBlur","setLineWidth","setLineCap","setLineDash"];t.vexFlowCanvasContext=t;for(var a in n){var i=n[a];t[i]=Vex.Flow.CanvasContext.prototype[i]}return t},e.drawDashedLine=function(e,t,n,a,i,o){e.beginPath();var s=a-t,r=i-n,l=Math.atan2(r,s),h=t,c=n;e.moveTo(t,n);for(var d=0,x=!0;!(0>s?a>=h:h>=a)||!(0>r?i>=c:c>=i);){var C=o[d++%o.length],u=h+Math.cos(l)*C;h=0>s?Math.max(a,u):Math.min(a,u);var m=c+Math.sin(l)*C;c=0>r?Math.max(i,m):Math.min(i,m),x?e.lineTo(h,c):e.moveTo(h,c),x=!x}e.closePath(),e.stroke()},e.prototype={init:function(t,n){if(this.sel=t,!this.sel)throw new Vex.RERR("BadArgument","Invalid selector for renderer.");if(this.element=document.getElementById(t),this.element||(this.element=t),this.ctx=null,this.paper=null,this.backend=n,this.backend==e.Backends.CANVAS){if(!this.element.getContext)throw new Vex.RERR("BadElement","Can't get canvas context from element: "+t);this.ctx=e.bolsterCanvasContext(this.element.getContext("2d"))}else{if(this.backend!=e.Backends.RAPHAEL)throw new Vex.RERR("InvalidBackend","No support for backend: "+this.backend);this.ctx=new Vex.Flow.RaphaelContext(this.element)}},resize:function(t,n){if(this.backend==e.Backends.CANVAS){if(!this.element.getContext)throw new Vex.RERR("BadElement","Can't get canvas context from element: "+this.sel);this.element.width=t,this.element.height=n,this.ctx=e.bolsterCanvasContext(this.element.getContext("2d"))}else this.ctx.resize(t,n);return this},getContext:function(){return this.ctx}},e}();Vex.Flow.RaphaelContext=function(){function t(t){arguments.length>0&&this.init(t)}return t.prototype={init:function(t){this.element=t,this.paper=Raphael(t),this.path="",this.pen={x:0,y:0},this.lineWidth=1,this.state={scale:{x:1,y:1},font_family:"Arial",font_size:8,font_weight:800},this.attributes={"stroke-width":.3,fill:"black",stroke:"black",font:"10pt Arial"},this.background_attributes={"stroke-width":0,fill:"white",stroke:"white",font:"10pt Arial"},this.shadow_attributes={width:0,color:"black"},this.state_stack=[]},setFont:function(t,i,s){return this.state.font_family=t,this.state.font_size=i,this.state.font_weight=s,this.attributes.font=(this.state.font_weight||"")+" "+this.state.font_size*this.state.scale.x+"pt "+this.state.font_family,this},setRawFont:function(t){return this.attributes.font=t,this},setFillStyle:function(t){return this.attributes.fill=t,this},setBackgroundFillStyle:function(t){return this.background_attributes.fill=t,this.background_attributes.stroke=t,this},setStrokeStyle:function(t){return this.attributes.stroke=t,this},setShadowColor:function(t){return this.shadow_attributes.color=t,this},setShadowBlur:function(t){return this.shadow_attributes.width=t,this},setLineWidth:function(t){this.attributes["stroke-width"]=t,this.lineWidth=t},setLineDash:function(){return this},setLineCap:function(){return this},scale:function(t,i){return this.state.scale={x:t,y:i},this.attributes.scale=t+","+i+",0,0",this.attributes.font=this.state.font_size*this.state.scale.x+"pt "+this.state.font_family,this.background_attributes.scale=t+","+i+",0,0",this.background_attributes.font=this.state.font_size*this.state.scale.x+"pt "+this.state.font_family,this},clear:function(){this.paper.clear()},resize:function(t,i){return this.element.style.width=t,this.paper.setSize(t,i),this},setViewBox:function(t){this.paper.canvas.setAttribute("viewBox",t)},rect:function(t,i,s,e){return 0>e&&(i+=e,e=-e),this.paper.rect(t,i,s-.5,e-.5).attr(this.attributes).attr("fill","none").attr("stroke-width",this.lineWidth),this},fillRect:function(t,i,s,e){return 0>e&&(i+=e,e=-e),this.paper.rect(t,i,s-.5,e-.5).attr(this.attributes),this},clearRect:function(t,i,s,e){return 0>e&&(i+=e,e=-e),this.paper.rect(t,i,s-.5,e-.5).attr(this.background_attributes),this},beginPath:function(){return this.path="",this.pen.x=0,this.pen.y=0,this},moveTo:function(t,i){return this.path+="M"+t+","+i,this.pen.x=t,this.pen.y=i,this},lineTo:function(t,i){return this.path+="L"+t+","+i,this.pen.x=t,this.pen.y=i,this},bezierCurveTo:function(t,i,s,e,r,h){return this.path+="C"+t+","+i+","+s+","+e+","+r+","+h,this.pen.x=r,this.pen.y=h,this},quadraticCurveTo:function(t,i,s,e){return this.path+="Q"+t+","+i+","+s+","+e,this.pen.x=s,this.pen.y=e,this},arc:function(t,i,s,e,r,h){function a(t){for(;0>t;)t+=2*Math.PI;for(;t>2*Math.PI;)t-=2*Math.PI;return t}if(e=a(e),r=a(r),e>r){var n=e;e=r,r=n,h=!h}var o=r-e;return o>Math.PI?(this.arcHelper(t,i,s,e,e+o/2,h),this.arcHelper(t,i,s,e+o/2,r,h)):this.arcHelper(t,i,s,e,r,h),this},arcHelper:function(t,i,s,e,r,h){var a=t+s*Math.cos(e),n=i+s*Math.sin(e),o=t+s*Math.cos(r),u=i+s*Math.sin(r),l=0,f=0;h?(f=1,r-e<Math.PI&&(l=1)):r-e>Math.PI&&(l=1),this.path+="M"+a+","+n+",A"+s+","+s+",0,"+l+","+f+","+o+","+u+"M"+this.pen.x+","+this.pen.y},glow:function(){var t=this.paper.set();if(this.shadow_attributes.width>0)for(var i=this.shadow_attributes,s=i.width/2,e=1;s>=e;e++)t.push(this.paper.path(this.path).attr({stroke:i.color,"stroke-linejoin":"round","stroke-linecap":"round","stroke-width":+(i.width/s*e).toFixed(3),opacity:+((i.opacity||.3)/s).toFixed(3)}));return t},fill:function(){var t=this.paper.path(this.path).attr(this.attributes).attr("stroke-width",0);return this.glow(t),this},stroke:function(){var t=this.paper.path(this.path).attr(this.attributes).attr("fill","none").attr("stroke-width",this.lineWidth);return this.glow(t),this},closePath:function(){return this.path+="Z",this},measureText:function(t){var i=this.paper.text(0,0,t).attr(this.attributes).attr("fill","none").attr("stroke","none"),s=i.getBBox();return i.remove(),{width:s.width,height:s.height}},fillText:function(t,i,s){return this.paper.text(i+this.measureText(t).width/2,s-this.state.font_size/(2.25*this.state.scale.y),t).attr(this.attributes),this},save:function(){return this.state_stack.push({state:{font_family:this.state.font_family},attributes:{font:this.attributes.font,fill:this.attributes.fill,stroke:this.attributes.stroke,"stroke-width":this.attributes["stroke-width"]},shadow_attributes:{width:this.shadow_attributes.width,color:this.shadow_attributes.color}}),this},restore:function(){var t=this.state_stack.pop();return this.state.font_family=t.state.font_family,this.attributes.font=t.attributes.font,this.attributes.fill=t.attributes.fill,this.attributes.stroke=t.attributes.stroke,this.attributes["stroke-width"]=t.attributes["stroke-width"],this.shadow_attributes.width=t.shadow_attributes.width,this.shadow_attributes.color=t.shadow_attributes.color,this}},t}();Vex.Flow.CanvasContext=function(){function t(t){arguments.length>0&&this.init(t)}return t.WIDTH=600,t.HEIGHT=400,t.prototype={init:function(n){this.vexFlowCanvasContext=n,this.canvas=n.canvas?this.context.canvas:{width:t.WIDTH,height:t.HEIGHT}},clear:function(){this.vexFlowCanvasContext.clearRect(0,0,this.canvas.width,this.canvas.height)},setFont:function(t,n,e){return this.vexFlowCanvasContext.font=(e||"")+" "+n+"pt "+t,this},setRawFont:function(t){return this.vexFlowCanvasContext.font=t,this},setFillStyle:function(t){return this.vexFlowCanvasContext.fillStyle=t,this},setBackgroundFillStyle:function(t){return this.background_fillStyle=t,this},setStrokeStyle:function(t){return this.vexFlowCanvasContext.strokeStyle=t,this},setShadowColor:function(t){return this.vexFlowCanvasContext.shadowColor=t,this},setShadowBlur:function(t){return this.vexFlowCanvasContext.shadowBlur=t,this},setLineWidth:function(t){return this.vexFlowCanvasContext.lineWidth=t,this},setLineCap:function(t){return this.vexFlowCanvasContext.lineCap=t,this},setLineDash:function(t){this.vexFlowCanvasContext.lineDash=t},scale:function(t,n){return this.vexFlowCanvasContext.scale(parseFloat(t),parseFloat(n))},resize:function(t,n){return this.vexFlowCanvasContext.resize(parseInt(t,10),parseInt(n,10))},rect:function(t,n,e,o){return this.vexFlowCanvasContext.rect(t,n,e,o)},fillRect:function(t,n,e,o){return this.vexFlowCanvasContext.fillRect(t,n,e,o)},clearRect:function(t,n,e,o){return this.vexFlowCanvasContext.clearRect(t,n,e,o)},beginPath:function(){return this.vexFlowCanvasContext.beginPath()},moveTo:function(t,n){return this.vexFlowCanvasContext.moveTo(t,n)},lineTo:function(t,n){return this.vexFlowCanvasContext.lineTo(t,n)},bezierCurveTo:function(t,n,e,o,s,i){return this.vexFlowCanvasContext.bezierCurveTo(t,n,e,o,s,i)},quadraticCurveTo:function(t,n,e,o){return this.vexFlowCanvasContext.quadraticCurveTo(t,n,e,o)},arc:function(t,n,e,o,s,i){return this.vexFlowCanvasContext.arc(t,n,e,o,s,i)},glow:function(){return this.vexFlowCanvasContext.glow()},fill:function(){return this.vexFlowCanvasContext.fill()},stroke:function(){return this.vexFlowCanvasContext.stroke()},closePath:function(){return this.vexFlowCanvasContext.closePath()},measureText:function(t){return this.vexFlowCanvasContext.measureText(t)},fillText:function(t,n,e){return this.vexFlowCanvasContext.fillText(t,n,e)},save:function(){return this.vexFlowCanvasContext.save()},restore:function(){return this.vexFlowCanvasContext.restore()}},t}();Vex.Flow.Barline=function(){function t(t,e){arguments.length>0&&this.init(t,e)}return t.type={SINGLE:1,DOUBLE:2,END:3,REPEAT_BEGIN:4,REPEAT_END:5,REPEAT_BOTH:6,NONE:7},Vex.Inherit(t,Vex.Flow.StaveModifier,{init:function(e,i){t.superclass.init.call(this),this.thickness=Vex.Flow.STAVE_LINE_THICKNESS,this.barline=e,this.x=i},getCategory:function(){return"barlines"},setX:function(t){return this.x=t,this},draw:function(e,i){switch(i="number"!=typeof i?0:i,this.barline){case t.type.SINGLE:this.drawVerticalBar(e,this.x,!1);break;case t.type.DOUBLE:this.drawVerticalBar(e,this.x,!0);break;case t.type.END:this.drawVerticalEndBar(e,this.x);break;case t.type.REPEAT_BEGIN:i>0&&this.drawVerticalBar(e,this.x),this.drawRepeatBar(e,this.x+i,!0);break;case t.type.REPEAT_END:this.drawRepeatBar(e,this.x,!1);break;case t.type.REPEAT_BOTH:this.drawRepeatBar(e,this.x,!1),this.drawRepeatBar(e,this.x,!0)}},drawVerticalBar:function(t,e,i){if(!t.context)throw new Vex.RERR("NoCanvasContext","Can't draw stave without canvas context.");var n=t.getYForLine(0),a=t.getYForLine(t.getNumLines()-1)+this.thickness;i&&t.context.fillRect(e-3,n,1,a-n),t.context.fillRect(e,n,1,a-n)},drawVerticalEndBar:function(t,e){if(!t.context)throw new Vex.RERR("NoCanvasContext","Can't draw stave without canvas context.");var i=t.getYForLine(0),n=t.getYForLine(t.getNumLines()-1)+this.thickness;t.context.fillRect(e-5,i,1,n-i),t.context.fillRect(e-2,i,3,n-i)},drawRepeatBar:function(t,e,i){if(!t.context)throw new Vex.RERR("NoCanvasContext","Can't draw stave without canvas context.");var n=t.getYForLine(0),a=t.getYForLine(t.getNumLines()-1)+this.thickness,r=3;i||(r=-5),t.context.fillRect(e+r,n,1,a-n),t.context.fillRect(e-2,n,3,a-n);var s=2;i?r+=4:r-=4;var c=e+r+s/2,o=(t.getNumLines()-1)*t.getSpacingBetweenLines();o=o/2-t.getSpacingBetweenLines()/2;var h=n+o+s/2;t.context.beginPath(),t.context.arc(c,h,s,0,2*Math.PI,!1),t.context.fill(),h+=t.getSpacingBetweenLines(),t.context.beginPath(),t.context.arc(c,h,s,0,2*Math.PI,!1),t.context.fill()}}),t}();Vex.Flow.StaveHairpin=function(){function t(t,i){arguments.length>0&&this.init(t,i)}return t.type={CRESC:1,DECRESC:2},t.FormatByTicksAndDraw=function(i,e,s,n,o,r){var h=e.pixelsPerTick;if(null==h)throw new Vex.RuntimeError("BadArguments","A valid Formatter must be provide to draw offsets by ticks.");var _=h*r.left_shift_ticks,f=h*r.right_shift_ticks,a={height:r.height,y_shift:r.y_shift,left_shift_px:_,right_shift_px:f};new t({first_note:s.first_note,last_note:s.last_note},n).setContext(i).setRenderOptions(a).setPosition(o).draw()},t.prototype={init:function(t,i){this.notes=t,this.hairpin=i,this.position=Vex.Flow.Modifier.Position.BELOW,this.context=null,this.render_options={height:10,y_shift:0,left_shift_px:0,right_shift_px:0},this.setNotes(t)},setContext:function(t){return this.context=t,this},setPosition:function(t){return(t==Vex.Flow.Modifier.Position.ABOVE||t==Vex.Flow.Modifier.Position.BELOW)&&(this.position=t),this},setRenderOptions:function(t){return null!=t.height&&null!=t.y_shift&&null!=t.left_shift_px&&null!=t.right_shift_px&&(this.render_options=t),this},setNotes:function(t){if(!t.first_note&&!t.last_note)throw new Vex.RuntimeError("BadArguments","Hairpin needs to have either first_note or last_note set.");return this.first_note=t.first_note,this.last_note=t.last_note,this},renderHairpin:function(i){var e=this.context,s=this.render_options.y_shift+20,n=i.first_y;this.position==Vex.Flow.Modifier.Position.ABOVE&&(s=-s+30,n=i.first_y-i.staff_height);var o=this.render_options.left_shift_px,r=this.render_options.right_shift_px;switch(this.hairpin){case t.type.CRESC:e.moveTo(i.last_x+r,n+s),e.lineTo(i.first_x+o,n+this.render_options.height/2+s),e.lineTo(i.last_x+r,n+this.render_options.height+s);break;case t.type.DECRESC:e.moveTo(i.first_x+o,n+s),e.lineTo(i.last_x+r,n+this.render_options.height/2+s),e.lineTo(i.first_x+o,n+this.render_options.height+s)}e.stroke()},draw:function(){if(!this.context)throw new Vex.RERR("NoContext","Can't draw Hairpin without a context.");var t=this.first_note,i=this.last_note,e=t.getModifierStartXY(this.position,0),s=i.getModifierStartXY(this.position,0);return this.renderHairpin({first_x:e.x,last_x:s.x,first_y:t.getStave().y+t.getStave().height,last_y:i.getStave().y+i.getStave().height,staff_height:t.getStave().height}),!0}},t}();Vex.Flow.Volta=function(){function t(t,i,e,s){arguments.length>0&&this.init(t,i,e,s)}return t.type={NONE:1,BEGIN:2,MID:3,END:4,BEGIN_END:5},Vex.Inherit(t,Vex.Flow.StaveModifier,{init:function(i,e,s,n){t.superclass.init.call(this),this.volta=i,this.x=s,this.y_shift=n,this.number=e,this.font={family:"sans-serif",size:9,weight:"bold"}},getCategory:function(){return"voltas"},setShiftY:function(t){return this.y_shift=t,this},draw:function(i,e){if(!i.context)throw new Vex.RERR("NoCanvasContext","Can't draw stave without canvas context.");var s=i.context,n=i.width,o=i.getYForTopText(i.options.num_lines)+this.y_shift,h=1.5*i.options.spacing_between_lines_px;switch(this.volta){case Vex.Flow.Volta.type.BEGIN:s.fillRect(this.x+e,o,1,h);break;case Vex.Flow.Volta.type.END:n-=5,s.fillRect(this.x+e+n,o,1,h);break;case Vex.Flow.Volta.type.BEGIN_END:n-=3,s.fillRect(this.x+e,o,1,h),s.fillRect(this.x+e+n,o,1,h)}return(this.volta==t.type.BEGIN||this.volta==t.type.BEGIN_END)&&(s.save(),s.setFont(this.font.family,this.font.size,this.font.weight),s.fillText(this.number,this.x+e+5,o+15),s.restore()),s.fillRect(this.x+e,o,n,1),this}}),t}();Vex.Flow.Repetition=function(){function t(t,e,i){arguments.length>0&&this.init(t,e,i)}return t.type={NONE:1,CODA_LEFT:2,CODA_RIGHT:3,SEGNO_LEFT:4,SEGNO_RIGHT:5,DC:6,DC_AL_CODA:7,DC_AL_FINE:8,DS:9,DS_AL_CODA:10,DS_AL_FINE:11,FINE:12},Vex.Inherit(t,Vex.Flow.StaveModifier,{init:function(e,i,s){t.superclass.init.call(this),this.symbol_type=e,this.x=i,this.x_shift=0,this.y_shift=s,this.font={family:"times",size:12,weight:"bold italic"}},getCategory:function(){return"repetitions"},setShiftX:function(t){return this.x_shift=t,this},setShiftY:function(t){return this.y_shift=t,this},draw:function(e,i){switch(this.symbol_type){case t.type.CODA_RIGHT:this.drawCodaFixed(e,i+e.width);break;case t.type.CODA_LEFT:this.drawSymbolText(e,i,"Coda",!0);break;case t.type.SEGNO_LEFT:this.drawSignoFixed(e,i);break;case t.type.SEGNO_RIGHT:this.drawSignoFixed(e,i+e.width);break;case t.type.DC:this.drawSymbolText(e,i,"D.C.",!1);break;case t.type.DC_AL_CODA:this.drawSymbolText(e,i,"D.C. al",!0);break;case t.type.DC_AL_FINE:this.drawSymbolText(e,i,"D.C. al Fine",!1);break;case t.type.DS:this.drawSymbolText(e,i,"D.S.",!1);break;case t.type.DS_AL_CODA:this.drawSymbolText(e,i,"D.S. al",!0);break;case t.type.DS_AL_FINE:this.drawSymbolText(e,i,"D.S. al Fine",!1);break;case t.type.FINE:this.drawSymbolText(e,i,"Fine",!1)}return this},drawCodaFixed:function(t,e){if(!t.context)throw new Vex.RERR("NoCanvasContext","Can't draw stave without canvas context.");var i=t.getYForTopText(t.options.num_lines)+this.y_shift;return Vex.Flow.renderGlyph(t.context,this.x+e+this.x_shift,i+25,40,"v4d",!0),this},drawSignoFixed:function(t,e){if(!t.context)throw new Vex.RERR("NoCanvasContext","Can't draw stave without canvas context.");var i=t.getYForTopText(t.options.num_lines)+this.y_shift;return Vex.Flow.renderGlyph(t.context,this.x+e+this.x_shift,i+25,30,"v8c",!0),this},drawSymbolText:function(t,e,i,s){if(!t.context)throw new Vex.RERR("NoCanvasContext","Can't draw stave without canvas context.");var n=t.context;n.save(),n.setFont(this.font.family,this.font.size,this.font.weight);var a=0+this.x_shift,o=e+this.x_shift;this.symbol_type==Vex.Flow.Repetition.type.CODA_LEFT?(a=this.x+t.options.vertical_bar_width,o=a+n.measureText(i).width+12):(o=this.x+e+t.width-5+this.x_shift,a=o-+n.measureText(i).width-12);var h=t.getYForTopText(t.options.num_lines)+this.y_shift;return s&&Vex.Flow.renderGlyph(n,o,h,40,"v4d",!0),n.fillText(i,a,h+5),n.restore(),this}}),t}();Vex.Flow.StaveSection=function(){function t(t,i,e){arguments.length>0&&this.init(t,i,e)}var i=Vex.Flow.Modifier;return Vex.Inherit(t,i,{init:function(e,s,n){t.superclass.init.call(this),this.setWidth(16),this.section=e,this.position=i.Position.ABOVE,this.x=s,this.shift_x=0,this.shift_y=n,this.font={family:"sans-serif",size:12,weight:"bold"}},getCategory:function(){return"stavesection"},setStaveSection:function(t){return this.section=t,this},setShiftX:function(t){return this.shift_x=t,this},setShiftY:function(t){return this.shift_y=t,this},draw:function(t,i){if(!t.context)throw new Vex.RERR("NoContext","Can't draw stave section without a context.");var e=t.context;e.save(),e.lineWidth=2,e.setFont(this.font.family,this.font.size,this.font.weight);var s=e.measureText(""+this.section).width,n=s+6;18>n&&(n=18);var h=20,o=t.getYForTopText(3)+this.shift_y,r=this.x+i;return e.beginPath(),e.lineWidth=2,e.rect(r,o,n,h),e.stroke(),r+=(n-s)/2,e.fillText(""+this.section,r,o+16),e.restore(),this}}),t}();Vex.Flow.StaveTempo=function(){function t(t,e,i){arguments.length>0&&this.init(t,e,i)}return Vex.Inherit(t,Vex.Flow.StaveModifier,{init:function(e,i,o){t.superclass.init.call(this),this.tempo=e,this.position=Vex.Flow.Modifier.Position.ABOVE,this.x=i,this.shift_x=10,this.shift_y=o,this.font={family:"times",size:14,weight:"bold"},this.render_options={glyph_font_scale:30}},getCategory:function(){return"stavetempo"},setTempo:function(t){return this.tempo=t,this},setShiftX:function(t){return this.shift_x=t,this},setShiftY:function(t){return this.shift_y=t,this},draw:function(t,e){if(!t.context)throw new Vex.RERR("NoContext","Can't draw stave tempo without a context.");var i=this.render_options,o=i.glyph_font_scale/38,s=this.tempo.name,n=this.tempo.duration,h=this.tempo.dots,r=this.tempo.bpm,a=this.font,f=t.context,l=this.x+this.shift_x+e,m=t.getYForTopText(1)+this.shift_y;if(f.save(),s&&(f.setFont(a.family,a.size,a.weight),f.fillText(s,l,m),l+=f.measureText(s).width),n&&r){f.setFont(a.family,a.size,"normal"),s&&(l+=f.measureText(" ").width,f.fillText("(",l,m),l+=f.measureText("(").width);var u=Vex.Flow.durationToGlyph(n);if(l+=3*o,Vex.Flow.renderGlyph(f,l,m,i.glyph_font_scale,u.code_head),l+=u.head_width*o,u.stem){var p=30;u.beam_count&&(p+=3*(u.beam_count-1)),p*=o;var x=m-p;f.fillRect(l,x,o,p),u.flag&&(Vex.Flow.renderGlyph(f,l+o,x,i.glyph_font_scale,u.code_flag_upstem),h||(l+=6*o))}for(var c=0;h>c;c++)l+=6*o,f.beginPath(),f.arc(l,m+2*o,2*o,0,2*Math.PI,!1),f.fill();f.fillText(" = "+r+(s?")":""),l+3*o,m)}return f.restore(),this}}),t}();Vex.Flow.StaveText=function(){function t(t,i,e){arguments.length>0&&this.init(t,i,e)}var i=Vex.Flow.Modifier;return Vex.Inherit(t,i,{init:function(i,e,o){t.superclass.init.call(this),this.setWidth(16),this.text=i,this.position=e,this.options={shift_x:0,shift_y:0,justification:Vex.Flow.TextNote.Justification.CENTER},Vex.Merge(this.options,o),this.font={family:"times",size:16,weight:"normal"}},getCategory:function(){return"stavetext"},setStaveText:function(t){return this.text=t,this},setShiftX:function(t){return this.shift_x=t,this},setShiftY:function(t){return this.shift_y=t,this},setFont:function(t){Vex.Merge(this.font,t)},setText:function(t){this.text=t},draw:function(t){if(!t.context)throw new Vex.RERR("NoContext","Can't draw stave text without a context.");var i=t.context;i.save(),i.lineWidth=2,i.setFont(this.font.family,this.font.size,this.font.weight);var e,o,s=i.measureText(""+this.text).width,n=Vex.Flow.Modifier;switch(this.position){case n.Position.LEFT:case n.Position.RIGHT:o=(t.getYForLine(0)+t.getBottomLineY())/2+this.options.shift_y,e=this.position==n.Position.LEFT?t.getX()-s-24+this.options.shift_x:t.getX()+t.getWidth()+24+this.options.shift_x;break;case n.Position.ABOVE:case n.Position.BELOW:var h=Vex.Flow.TextNote.Justification;e=t.getX()+this.options.shift_x,this.options.justification==h.CENTER?e+=t.getWidth()/2-s/2:this.options.justification==h.RIGHT&&(e+=t.getWidth()-s),o=this.position==n.Position.ABOVE?t.getYForTopText(2)+this.options.shift_y:t.getYForBottomText(2)+this.options.shift_y;break;default:throw new Vex.RERR("InvalidPosition","Value Must be in Modifier.Position.")}return i.fillText(""+this.text,e,o+4),i.restore(),this}}),t}();Vex.Flow.BarNote=function(){function t(){this.init()}function i(){t.DEBUG&&Vex.L("Vex.Flow.BarNote",arguments)}return Vex.Inherit(t,Vex.Flow.Note,{init:function(){t.superclass.init.call(this,{duration:"b"});var i=Vex.Flow.Barline.type;this.metrics={widths:{}},this.metrics.widths[i.SINGLE]=8,this.metrics.widths[i.DOUBLE]=12,this.metrics.widths[i.END]=15,this.metrics.widths[i.REPEAT_BEGIN]=14,this.metrics.widths[i.REPEAT_END]=14,this.metrics.widths[i.REPEAT_BOTH]=18,this.metrics.widths[i.NONE]=0,this.ignore_ticks=!0,this.type=i.SINGLE,this.setWidth(this.metrics.widths[this.type])},getType:function(){return this.type},setType:function(t){return this.type=t,this.setWidth(this.metrics.widths[this.type]),this},getBoundingBox:function(){return new Vex.Flow.BoundingBox(0,0,0,0)},addToModifierContext:function(){return this},preFormat:function(){return this.setPreFormatted(!0),this},draw:function(){if(!this.stave)throw new Vex.RERR("NoStave","Can't draw without a stave.");i("Rendering bar line at: ",this.getAbsoluteX());var t=new Vex.Flow.Barline(this.type,this.getAbsoluteX());t.draw(this.stave)}}),t}();Vex.Flow.Tremolo=function(){function t(t){arguments.length>0&&this.init(t)}var i=Vex.Flow.Modifier;return Vex.Inherit(t,i,{init:function(n){t.superclass.init.call(this),this.num=n,this.note=null,this.index=null,this.position=i.Position.CENTER,this.code="v74",this.shift_right=-2,this.y_spacing=4,this.render_options={font_scale:35,stroke_px:3,stroke_spacing:10},this.font={family:"Arial",size:16,weight:""}},getCategory:function(){return"tremolo"},draw:function(){if(!this.context)throw new Vex.RERR("NoContext","Can't draw Tremolo without a context.");if(!this.note||null==this.index)throw new Vex.RERR("NoAttachedNote","Can't draw Tremolo without a note and index.");var t=this.note.getModifierStartXY(this.position,this.index),i=t.x,n=t.y;i+=this.shift_right;for(var o=0;o<this.num;++o)Vex.Flow.renderGlyph(this.context,i,n,this.render_options.font_scale,this.code),n+=this.y_spacing}}),t}();Vex.Flow.Tuplet=function(){function t(t,s){arguments.length>0&&this.init(t,s)}return t.LOCATION_TOP=1,t.LOCATION_BOTTOM=-1,t.prototype={init:function(s,i){if(!s||s==[])throw new Vex.RuntimeError("BadArguments","No notes provided for tuplet.");if(1==s.length)throw new Vex.RuntimeError("BadArguments","Too few notes for tuplet.");this.options=Vex.Merge({},i),this.notes=s,this.num_notes="num_notes"in this.options?this.options.num_notes:s.length,this.beats_occupied="beats_occupied"in this.options?this.options.beats_occupied:2,this.bracketed=null==s[0].beam,this.ratioed=!1,this.point=28,this.y_pos=16,this.x_pos=100,this.width=200,this.location=t.LOCATION_TOP,Vex.Flow.Formatter.AlignRestsToNotes(s,!0,!0),this.resolveGlyphs(),this.attach()},attach:function(){for(var t=0;t<this.notes.length;t++){var s=this.notes[t];s.setTuplet(this)}},detach:function(){for(var t=0;t<this.notes.length;t++){var s=this.notes[t];s.setTuplet(null)}},setContext:function(t){return this.context=t,this},setBracketed:function(t){return this.bracketed=t?!0:!1,this},setRatioed:function(t){return this.ratioed=t?!0:!1,this},setTupletLocation:function(s){if(s){if(s!=t.LOCATION_TOP&&s!=t.LOCATION_BOTTOM)throw new Vex.RERR("BadArgument","Invalid tuplet location: "+s)}else s=t.LOCATION_TOP;return this.location=s,this},getNotes:function(){return this.notes},getNoteCount:function(){return this.num_notes},getBeatsOccupied:function(){return this.beats_occupied},setBeatsOccupied:function(t){this.detach(),this.beats_occupied=t,this.resolveGlyphs(),this.attach()},resolveGlyphs:function(){this.num_glyphs=[];for(var t=this.num_notes;t>=1;)this.num_glyphs.push(new Vex.Flow.Glyph("v"+t%10,this.point)),t=parseInt(t/10,10);for(this.denom_glyphs=[],t=this.beats_occupied;t>=1;)this.denom_glyphs.push(new Vex.Flow.Glyph("v"+t%10,this.point)),t=parseInt(t/10,10)},draw:function(){if(!this.context)throw new Vex.RERR("NoCanvasContext","Can't draw without a canvas context.");var s=this.notes[0],i=this.notes[this.notes.length-1];this.bracketed?(this.x_pos=s.getTieLeftX()-5,this.width=i.getTieRightX()-this.x_pos+5):(this.x_pos=s.getStemX(),this.width=i.getStemX()-this.x_pos);var e;if(this.location==t.LOCATION_TOP)for(this.y_pos=s.getStave().getYForLine(0)-15,e=0;e<this.notes.length;++e){var h=this.notes[e].getStemExtents().topY-10;h<this.y_pos&&(this.y_pos=h)}else for(this.y_pos=s.getStave().getYForLine(4)+20,e=0;e<this.notes.length;++e){var o=this.notes[e].getStemExtents().topY+10;o>this.y_pos&&(this.y_pos=o)}var n,r=0;for(n in this.num_glyphs)r+=this.num_glyphs[n].getMetrics().width;if(this.ratioed){for(n in this.denom_glyphs)r+=this.denom_glyphs[n].getMetrics().width;r+=.32*this.point}var p=this.x_pos+this.width/2,c=p-r/2;if(this.bracketed){var a=this.width/2-r/2-5;a>0&&(this.context.fillRect(this.x_pos,this.y_pos,a,1),this.context.fillRect(this.x_pos+this.width/2+r/2+5,this.y_pos,a,1),this.context.fillRect(this.x_pos,this.y_pos+(this.location==t.LOCATION_BOTTOM),1,10*this.location),this.context.fillRect(this.x_pos+this.width,this.y_pos+(this.location==t.LOCATION_BOTTOM),1,10*this.location))}var l=0,u=this.num_glyphs.length;for(n in this.num_glyphs)this.num_glyphs[u-n-1].render(this.context,c+l,this.y_pos+this.point/3-2),l+=this.num_glyphs[u-n-1].getMetrics().width;if(this.ratioed){var _=c+l+.16*this.point,g=.06*this.point;this.context.beginPath(),this.context.arc(_,this.y_pos-.08*this.point,g,0,2*Math.PI,!0),this.context.closePath(),this.context.fill(),this.context.beginPath(),this.context.arc(_,this.y_pos+.12*this.point,g,0,2*Math.PI,!0),this.context.closePath(),this.context.fill(),l+=.32*this.point,u=this.denom_glyphs.length;for(n in this.denom_glyphs)this.denom_glyphs[u-n-1].render(this.context,c+l,this.y_pos+this.point/3-2),l+=this.denom_glyphs[u-n-1].getMetrics().width}}},t}();Vex.Flow.BoundingBox=function(){function t(t,i,h,n){this.init(t,i,h,n)}return t.copy=function(i){return new t(i.x,i.y,i.w,i.h)},t.prototype={init:function(t,i,h,n){this.x=t,this.y=i,this.w=h,this.h=n},getX:function(){return this.x},getY:function(){return this.y},getW:function(){return this.w},getH:function(){return this.h},setX:function(t){return this.x=t,this},setY:function(t){return this.y=t,this},setW:function(t){return this.w=t,this},setH:function(t){return this.h=t,this},move:function(t,i){this.x+=t,this.y+=i},clone:function(){return t.copy(this)},mergeWith:function(t,i){var h=t,n=this.x<h.x?this.x:h.x,s=this.y<h.y?this.y:h.y,e=this.x+this.w<h.x+h.w?h.x+h.w-this.x:this.x+this.w-Vex.Min(this.x,h.x),r=this.y+this.h<h.y+h.h?h.y+h.h-this.y:this.y+this.h-Vex.Min(this.y,h.y);return this.x=n,this.y=s,this.w=e,this.h=r,i&&this.draw(i),this},draw:function(t,i,h){i||(i=0),h||(h=0),t.rect(this.x+i,this.y+h,this.w,this.h),t.stroke()}},t}();Vex.Flow.TextNote=function(){function t(t){arguments.length>0&&this.init(t)}return t.Justification={LEFT:1,CENTER:2,RIGHT:3},t.GLYPHS={segno:{code:"v8c",point:40,x_shift:0,y_shift:-10},tr:{code:"v1f",point:40,x_shift:0,y_shift:0},mordent_upper:{code:"v1e",point:40,x_shift:0,y_shift:0},mordent_lower:{code:"v45",point:40,x_shift:0,y_shift:0},f:{code:"vba",point:40,x_shift:0,y_shift:0},p:{code:"vbf",point:40,x_shift:0,y_shift:0},m:{code:"v62",point:40,x_shift:0,y_shift:0},s:{code:"v4a",point:40,x_shift:0,y_shift:0},z:{code:"v80",point:40,x_shift:0,y_shift:0},coda:{code:"v4d",point:40,x_shift:0,y_shift:-8},pedal_open:{code:"v36",point:40,x_shift:0,y_shift:0},pedal_close:{code:"v5d",point:40,x_shift:0,y_shift:3},caesura_straight:{code:"v34",point:40,x_shift:0,y_shift:2},caesura_curved:{code:"v4b",point:40,x_shift:0,y_shift:2},breath:{code:"v6c",point:40,x_shift:0,y_shift:0},tick:{code:"v6f",point:50,x_shift:0,y_shift:0},turn:{code:"v72",point:40,x_shift:0,y_shift:0},turn_inverted:{code:"v33",point:40,x_shift:0,y_shift:0},mordent:{code:"v1e",point:40,x_shift:0,y_shift:0}},Vex.Inherit(t,Vex.Flow.Note,{init:function(i){if(t.superclass.init.call(this,i),this.text=i.text,this.superscript=i.superscript,this.subscript=i.subscript,this.glyph_type=i.glyph,this.glyph=null,this.font={family:"Arial",size:12,weight:""},i.font&&(this.font=i.font),this.glyph_type){var s=t.GLYPHS[this.glyph_type];if(!s)throw new Vex.RERR("Invalid glyph type: "+this.glyph_type);this.glyph=new Vex.Flow.Glyph(s.code,s.point,{cache:!1}),this.setWidth(s.width?s.width:this.glyph.getMetrics().width),this.glyph_struct=s}else this.setWidth(Vex.Flow.textWidth(this.text));this.line=i.line||0,this.smooth=i.smooth||!1,this.ignore_ticks=i.ignore_ticks||!1,this.justification=t.Justification.LEFT},setJustification:function(t){return this.justification=t,this},setLine:function(t){return this.line=t,this},preFormat:function(){if(!this.context)throw new Vex.RERR("NoRenderContext","Can't measure text without rendering context.");this.preFormatted||(this.smooth?this.setWidth(0):this.glyph||this.setWidth(this.context.measureText(this.text).width),this.justification==t.Justification.CENTER?this.extraLeftPx=this.width/2:this.justification==t.Justification.RIGHT&&(this.extraLeftPx=this.width),this.setPreFormatted(!0))},draw:function(){if(!this.context)throw new Vex.RERR("NoCanvasContext","Can't draw without a canvas context.");if(!this.stave)throw new Vex.RERR("NoStave","Can't draw without a stave.");var i=this.context,s=this.getAbsoluteX();this.justification==t.Justification.CENTER?s-=this.getWidth()/2:this.justification==t.Justification.RIGHT&&(s-=this.getWidth());var e;if(this.glyph)e=this.stave.getYForLine(this.line+-3),this.glyph.render(this.context,s+this.glyph_struct.x_shift,e+this.glyph_struct.y_shift);else{e=this.stave.getYForLine(this.line+-3),i.save(),i.setFont(this.font.family,this.font.size,this.font.weight),i.fillText(this.text,s,e);var h=i.measureText("M").width,o=i.measureText(this.text).width;this.superscript&&(i.setFont(this.font.family,this.font.size/1.3,this.font.weight),i.fillText(this.superscript,s+o+2,e-h/2.2)),this.subscript&&(i.setFont(this.font.family,this.font.size/1.3,this.font.weight),i.fillText(this.subscript,s+o+2,e+h/2.2-1)),i.restore()}}}),t}();Vex.Flow.FretHandFinger=function(){function t(t){arguments.length>0&&this.init(t)}t.CATEGORY="frethandfinger";var i=Vex.Flow.Modifier;return t.format=function(t,i){var e=i.left_shift,n=i.right_shift,s=1;if(!t||0===t.length)return!1;var o,h,r,f,a,u=[],l=null,g=0,x=0;for(o=0;o<t.length;++o){h=t[o],r=h.getNote(),f=h.getPosition();var d=r.getKeyProps()[h.getIndex()];if(r!=l){for(var c=0;c<r.keys.length;++c)a=r.getKeyProps()[c],0===e&&(g=a.displaced?r.getExtraLeftPx():g),0===n&&(x=a.displaced?r.getExtraRightPx():x);l=r}u.push({line:d.line,pos:f,shiftL:g,shiftR:x,note:r,num:h})}u.sort(function(t,i){return i.line-t.line});var w=0,F=0,P=0,_=0,p=null,v=null;for(o=0;o<u.length;++o){var E=0;r=u[o].note,f=u[o].pos,h=u[o].num;var R=u[o].line,y=u[o].shiftL,L=u[o].shiftR;(R!=p||r!=v)&&(w=e+y,F=n+L);var V=h.getWidth()+s;f==Vex.Flow.Modifier.Position.LEFT?(h.setXShift(e+w),E=e+V,P=E>P?E:P):f==Vex.Flow.Modifier.Position.RIGHT&&(h.setXShift(F),E=x+V,_=E>_?E:_),p=R,v=r}i.left_shift+=P,i.right_shift+=_},Vex.Inherit(t,i,{init:function(t){var e=Vex.Flow.FretHandFinger.superclass;e.init.call(this),this.note=null,this.index=null,this.finger=t,this.width=7,this.position=i.Position.LEFT,this.x_shift=0,this.y_shift=0,this.x_offset=0,this.y_offset=0,this.font={family:"sans-serif",size:9,weight:"bold"}},getNote:function(){return this.note},setNote:function(t){return this.note=t,this},getIndex:function(){return this.index},setIndex:function(t){return this.index=t,this},getPosition:function(){return this.position},setPosition:function(t){return t>=i.Position.LEFT&&t<=i.Position.BELOW&&(this.position=t),this},setFretHandFinger:function(t){return this.finger=t,this},setOffsetX:function(t){return this.x_offset=t,this},setOffsetY:function(t){return this.y_offset=t,this},draw:function(){if(!this.context)throw new Vex.RERR("NoContext","Can't draw string number without a context.");if(!this.note||null==this.index)throw new Vex.RERR("NoAttachedNote","Can't draw string number without a note and index.");var t=this.context,e=this.note.getModifierStartXY(this.position,this.index),n=e.x+this.x_shift+this.x_offset,s=e.y+this.y_shift+this.y_offset+5;switch(this.position){case i.Position.ABOVE:n-=4,s-=12;break;case i.Position.BELOW:n-=2,s+=10;break;case i.Position.LEFT:n-=this.width;break;case i.Position.RIGHT:n+=1}t.save(),t.setFont(this.font.family,this.font.size,this.font.weight),t.fillText(""+this.finger,n,s),t.restore()}}),t}();Vex.Flow.StringNumber=function(){function t(t){arguments.length>0&&this.init(t)}t.CATEGORY="stringnumber";var e=Vex.Flow.Modifier;return t.format=function(t,e){var i=e.left_shift,s=e.right_shift,n=1;if(!t||0===t.length)return this;var o,h,r,a,f,d=[],l=null,u=0,x=0;for(o=0;o<t.length;++o)for(h=t[o],r=h.getNote(),o=0;o<t.length;++o){h=t[o],r=h.getNote(),a=h.getPosition();var g=r.getKeyProps()[h.getIndex()];if(r!=l){for(var c=0;c<r.keys.length;++c)f=r.getKeyProps()[c],0===i&&(u=f.displaced?r.getExtraLeftPx():u),0===s&&(x=f.displaced?r.getExtraRightPx():x);l=r}d.push({line:g.line,pos:a,shiftL:u,shiftR:x,note:r,num:h})}d.sort(function(t,e){return e.line-t.line});var w=0,_=0,p=0,E=0,y=null,m=null;for(o=0;o<d.length;++o){var R=0;r=d[o].note,a=d[o].pos,h=d[o].num;var P=d[o].line,V=d[o].shiftL,L=d[o].shiftR;(P!=y||r!=m)&&(w=i+V,_=s+L);var F=h.getWidth()+n;a==Vex.Flow.Modifier.Position.LEFT?(h.setXShift(i),R=u+F,p=R>p?R:p):a==Vex.Flow.Modifier.Position.RIGHT&&(h.setXShift(_),R+=F,E=R>E?R:E),y=P,m=r}return e.left_shift+=p,e.right_shift+=E,!0},Vex.Inherit(t,e,{init:function(i){t.superclass.init.call(this),this.note=null,this.last_note=null,this.index=null,this.string_number=i,this.setWidth(20),this.position=e.Position.ABOVE,this.x_shift=0,this.y_shift=0,this.x_offset=0,this.y_offset=0,this.dashed=!0,this.leg=Vex.Flow.Renderer.LineEndType.NONE,this.radius=8,this.font={family:"sans-serif",size:10,weight:"bold"}},getNote:function(){return this.note},setNote:function(t){return this.note=t,this},getIndex:function(){return this.index},setIndex:function(t){return this.index=t,this},setLineEndType:function(t){return t>=Vex.Flow.Renderer.LineEndType.NONE&&t<=Vex.Flow.Renderer.LineEndType.DOWN&&(this.leg=t),this},getPosition:function(){return this.position},setPosition:function(t){return t>=e.Position.LEFT&&t<=e.Position.BELOW&&(this.position=t),this},setStringNumber:function(t){return this.string_number=t,this},setOffsetX:function(t){return this.x_offset=t,this},setOffsetY:function(t){return this.y_offset=t,this},setLastNote:function(t){return this.last_note=t,this},setDashed:function(t){return this.dashed=t,this},draw:function(){if(!this.context)throw new Vex.RERR("NoContext","Can't draw string number without a context.");if(!this.note||null==this.index)throw new Vex.RERR("NoAttachedNote","Can't draw string number without a note and index.");var t=this.context,i=this.note.stave.options.spacing_between_lines_px,s=this.note.getModifierStartXY(this.position,this.index),n=s.x+this.x_shift+this.x_offset,o=s.y+this.y_shift+this.y_offset;switch(this.position){case e.Position.ABOVE:case e.Position.BELOW:var h=this.note.getStemExtents(),r=h.topY,a=h.baseY+2;this.note.stem_direction==Vex.Flow.StaveNote.STEM_DOWN&&(r=h.baseY,a=h.topY-2),o=this.position==e.Position.ABOVE?this.note.hasStem()?r-1.75*i:s.y-1.75*i:this.note.hasStem()?a+1.5*i:s.y+1.75*i,o+=this.y_shift+this.y_offset;break;case e.Position.LEFT:n-=this.radius/2+5;break;case e.Position.RIGHT:n+=this.radius/2+6}t.save(),t.beginPath(),t.arc(n,o,this.radius,0,2*Math.PI,!1),t.lineWidth=1.5,t.stroke(),t.setFont(this.font.family,this.font.size,this.font.weight);var f=n-t.measureText(this.string_number).width/2;if(t.fillText(""+this.string_number,f,o+4.5),null!=this.last_note){var d=this.last_note.getStemX()-this.note.getX()+5;t.strokeStyle="#000000",t.lineCap="round",t.lineWidth=.6,this.dashed?Vex.Flow.Renderer.drawDashedLine(t,n+10,o,n+d,o,[3,3]):Vex.Flow.Renderer.drawDashedLine(t,n+10,o,n+d,o,[3,0]);var l,u;switch(this.leg){case Vex.Flow.Renderer.LineEndType.UP:l=-10,u=this.dashed?[3,3]:[3,0],Vex.Flow.Renderer.drawDashedLine(t,n+d,o,n+d,o+l,u);break;case Vex.Flow.Renderer.LineEndType.DOWN:l=10,u=this.dashed?[3,3]:[3,0],Vex.Flow.Renderer.drawDashedLine(t,n+d,o,n+d,o+l,u)}}t.restore()}}),t}();Vex.Flow.Stroke=function(){function t(t,e){arguments.length>0&&this.init(t,e)}t.CATEGORY="strokes",t.Type={BRUSH_DOWN:1,BRUSH_UP:2,ROLL_DOWN:3,ROLL_UP:4,RASQUEDO_DOWN:5,RASQUEDO_UP:6};var e=Vex.Flow.Modifier;return t.format=function(t,e){var i=e.left_shift,s=0;if(!t||0===t.length)return this;var o,n,h,r=[];for(o=0;o<t.length;++o){n=t[o];var a,l=n.getNote();l instanceof Vex.Flow.StaveNote?(a=l.getKeyProps()[n.getIndex()],h=a.displaced?l.getExtraLeftPx():0,r.push({line:a.line,shift:h,str:n})):(a=l.getPositions()[n.getIndex()],r.push({line:a.str,shift:0,str:n}))}var f=i,x=0;for(o=0;o<r.length;++o)n=r[o].str,h=r[o].shift,n.setXShift(f+h),x=Math.max(n.getWidth()+s,x);return e.left_shift+=x,!0},Vex.Inherit(t,e,{init:function(i,s){t.superclass.init.call(this),this.note=null,this.options=Vex.Merge({},s),this.all_voices="all_voices"in this.options?this.options.all_voices:!0,this.note_end=null,this.index=null,this.type=i,this.position=e.Position.LEFT,this.render_options={font_scale:38,stroke_px:3,stroke_spacing:10},this.font={family:"serif",size:10,weight:"bold italic"},this.setXShift(0),this.setWidth(10)},getPosition:function(){return this.position},addEndNote:function(t){return this.note_end=t,this},draw:function(){if(!this.context)throw new Vex.RERR("NoContext","Can't draw stroke without a context.");if(!this.note||null==this.index)throw new Vex.RERR("NoAttachedNote","Can't draw stroke without a note and index.");var e,i=this.note.getModifierStartXY(this.position,this.index),s=this.note.getYs(),o=i.y,n=i.y,h=i.x-5,r=this.note.stave.options.spacing_between_lines_px,a=this.getModifierContext().getModifiers(this.note.getCategory());for(e=0;e<a.length;e++){s=a[e].getYs();for(var l=0;l<s.length;l++)(this.note==a[e]||this.all_voices)&&(o=Vex.Min(o,s[l]),n=Vex.Max(n,s[l]))}var f,x,c,_,p;switch(this.type){case t.Type.BRUSH_DOWN:f="vc3",x=-3,c=o-r/2+10,n+=r/2;break;case t.Type.BRUSH_UP:f="v11",x=.5,c=n+r/2,o-=r/2;break;case t.Type.ROLL_DOWN:case t.Type.RASQUEDO_DOWN:f="vc3",x=-3,_=this.x_shift+x-2,this.note instanceof Vex.Flow.StaveNote?(o+=1.5*r,n+=(n-o)%2!==0?.5*r:r,c=o-r,p=n+r+2):(o+=1.5*r,n+=r,c=o-.75*r,p=n+.25*r);break;case t.Type.ROLL_UP:case t.Type.RASQUEDO_UP:f="v52",x=-4,_=this.x_shift+x-1,this.note instanceof Vex.Flow.StaveNote?(c=r/2,o+=.5*r,(n-o)%2===0&&(n+=r/2),c=n+.5*r,p=o-1.25*r):(o+=.25*r,n+=.5*r,c=n+.25*r,p=o-r)}if(this.type==t.Type.BRUSH_DOWN||this.type==t.Type.BRUSH_UP)this.context.fillRect(h+this.x_shift,o,1,n-o);else if(this.note instanceof Vex.Flow.StaveNote)for(e=o;n>=e;e+=r)Vex.Flow.renderGlyph(this.context,h+this.x_shift-4,e,this.render_options.font_scale,"va3");else{for(e=o;n>=e;e+=10)Vex.Flow.renderGlyph(this.context,h+this.x_shift-4,e,this.render_options.font_scale,"va3");this.type==Vex.Flow.Stroke.Type.RASQUEDO_DOWN&&(p=e+.25*r)}Vex.Flow.renderGlyph(this.context,h+this.x_shift+x,c,this.render_options.font_scale,f),(this.type==t.Type.RASQUEDO_DOWN||this.type==t.Type.RASQUEDO_UP)&&(this.context.save(),this.context.setFont(this.font.family,this.font.size,this.font.weight),this.context.fillText("R",h+_,p),this.context.restore())}}),t}();Vex.Flow.Curve=function(){function t(t,e,i){arguments.length>0&&this.init(t,e,i)}return t.Position={NEAR_HEAD:1,NEAR_TOP:2},t.DEBUG=!0,t.prototype={init:function(e,i,n){this.render_options={spacing:2,thickness:2,x_shift:0,y_shift:10,position:t.Position.NEAR_HEAD,invert:!1,cps:[{x:0,y:10},{x:0,y:10}]},Vex.Merge(this.render_options,n),this.setNotes(e,i)},setContext:function(t){return this.context=t,this},setNotes:function(t,e){if(!t&&!e)throw new Vex.RuntimeError("BadArguments","Curve needs to have either first_note or last_note set.");return this.from=t,this.to=e,this},isPartial:function(){return!this.from||!this.to},renderCurve:function(t){var e=this.context,i=this.render_options.cps,n=this.render_options.x_shift,o=this.render_options.y_shift*t.direction,s=t.first_x+n,r=t.first_y+o,h=t.last_x-n,_=t.last_y+o,c=this.render_options.thickness,x=(h-s)/(i.length+2);e.beginPath(),e.moveTo(s,r),e.bezierCurveTo(s+x+i[0].x,r+i[0].y*t.direction,h-x+i[1].x,_+i[1].y*t.direction,h,_),e.bezierCurveTo(h-x+i[1].x,_+(i[1].y+c)*t.direction,s+x+i[0].x,r+(i[0].y+c)*t.direction,s,r),e.stroke(),e.closePath(),e.fill()},draw:function(){if(!this.context)throw new Vex.RERR("NoContext","No context to render tie.");var e,i,n,o,s,r=this.from,h=this.to,_="baseY",c="baseY",x=this.render_options.position,f=this.render_options.position_end;return x===t.Position.NEAR_TOP&&(_="topY",c="topY"),f==t.Position.NEAR_HEAD?c="baseY":f==t.Position.NEAR_TOP&&(c="topY"),r?(e=r.getTieRightX(),s=r.getStemDirection(),n=r.getStemExtents()[_]):(e=h.getStave().getTieStartX(),n=h.getStemExtents()[_]),h?(i=h.getTieLeftX(),s=h.getStemDirection(),o=h.getStemExtents()[c]):(i=r.getStave().getTieEndX(),o=r.getStemExtents()[c]),this.renderCurve({first_x:e,last_x:i,first_y:n,last_y:o,direction:s*(this.render_options.invert===!0?-1:1)}),!0}},t}();Vex.Flow.StaveLine=function(){function t(t){arguments.length>0&&this.init(t)}function e(t,e,i,n,o,s,r){t.beginPath(),t.moveTo(e,i),t.lineTo(n,o),t.lineTo(s,r),t.lineTo(e,i),t.closePath(),t.fill()}function i(t,i,n,o){var s,r,a,h,l=o.draw_start_arrow&&o.draw_end_arrow,d=i.x,_=i.y,c=n.x,x=n.y,f=Math.sqrt((c-d)*(c-d)+(x-_)*(x-_)),g=(f-o.arrowhead_length/3)/f;o.draw_end_arrow||l?(s=Math.round(d+(c-d)*g),r=Math.round(_+(x-_)*g)):(s=c,r=x),o.draw_start_arrow||l?(a=d+(c-d)*(1-g),h=_+(x-_)*(1-g)):(a=d,h=_),o.color&&(t.setStrokeStyle(o.color),t.setFillStyle(o.color)),t.beginPath(),t.moveTo(a,h),t.lineTo(s,r),t.stroke(),t.closePath();var w,u,p,T,y,v,M=Math.atan2(x-_,c-d),P=Math.abs(o.arrowhead_length/Math.cos(o.arrowhead_angle));(o.draw_end_arrow||l)&&(w=M+Math.PI+o.arrowhead_angle,p=c+Math.cos(w)*P,T=x+Math.sin(w)*P,u=M+Math.PI-o.arrowhead_angle,y=c+Math.cos(u)*P,v=x+Math.sin(u)*P,e(t,p,T,c,x,y,v)),(o.draw_start_arrow||l)&&(w=M+o.arrowhead_angle,p=d+Math.cos(w)*P,T=_+Math.sin(w)*P,u=M-o.arrowhead_angle,y=d+Math.cos(u)*P,v=_+Math.sin(u)*P,e(t,p,T,d,_,y,v))}return t.TextVerticalPosition={TOP:1,BOTTOM:2},t.TextJustification={LEFT:1,CENTER:2,RIGHT:3},t.prototype={init:function(e){this.notes=e,this.context=null,this.text="",this.font={family:"Arial",size:10,weight:""},this.render_options={padding_left:4,padding_right:3,line_width:1,line_dash:null,rounded_end:!0,color:null,draw_start_arrow:!1,draw_end_arrow:!1,arrowhead_length:10,arrowhead_angle:Math.PI/8,text_position_vertical:t.TextVerticalPosition.TOP,text_justification:t.TextJustification.CENTER},this.setNotes(e)},setContext:function(t){return this.context=t,this},setFont:function(t){return this.font=t,this},setText:function(t){return this.text=t,this},setNotes:function(t){if(!t.first_note&&!t.last_note)throw new Vex.RuntimeError("BadArguments","Notes needs to have either first_note or last_note set.");if(t.first_indices||(t.first_indices=[0]),t.last_indices||(t.last_indices=[0]),t.first_indices.length!=t.last_indices.length)throw new Vex.RuntimeError("BadArguments","Connected notes must have similar index sizes");return this.first_note=t.first_note,this.first_indices=t.first_indices,this.last_note=t.last_note,this.last_indices=t.last_indices,this},applyLineStyle:function(){if(!this.context)throw new Vex.RERR("NoContext","No context to apply the styling to");var t=this.render_options,e=this.context;t.line_dash&&e.setLineDash(t.line_dash),t.line_width&&e.setLineWidth(t.line_width),e.setLineCap(t.rounded_end?"round":"square")},applyFontStyle:function(){if(!this.context)throw new Vex.RERR("NoContext","No context to apply the styling to");var t=this.context;this.font&&t.setFont(this.font.family,this.font.size,this.font.weight),this.render_options.color&&(t.setStrokeStyle(this.render_options.color),t.setFillStyle(this.render_options.color))},draw:function(){if(!this.context)throw new Vex.RERR("NoContext","No context to render StaveLine.");var e=this.context,n=this.first_note,o=this.last_note,s=this.render_options;e.save(),this.applyLineStyle();var r,a;this.first_indices.forEach(function(t,h){var l=this.last_indices[h];r=n.getModifierStartXY(2,t),a=o.getModifierStartXY(1,l);var d=r.y>a.y;r.x+=n.getMetrics().modRightPx+s.padding_left,a.x-=o.getMetrics().modLeftPx+s.padding_right;var _=n.getGlyph().head_width,c=n.getKeyProps()[t].displaced;c&&1===n.getStemDirection()&&(r.x+=_+s.padding_left);var x=o.getKeyProps()[l].displaced;x&&-1===o.getStemDirection()&&(a.x-=_+s.padding_right),r.y+=d?-3:1,a.y+=d?2:0,i(e,r,a,this.render_options)},this),e.restore();var h=e.measureText(this.text).width,l=s.text_justification,d=0;if(l===t.TextJustification.LEFT)d=r.x;else if(l===t.TextJustification.CENTER){var _=a.x-r.x,c=_/2+r.x;d=c-h/2}else l===t.TextJustification.RIGHT&&(d=a.x-h);var x,f=s.text_position_vertical;return f===t.TextVerticalPosition.TOP?x=n.getStave().getYForTopText():f===t.TextVerticalPosition.BOTTOM&&(x=n.getStave().getYForBottomText()),e.save(),this.applyFontStyle(),e.fillText(this.text,d,x),e.restore(),this}},t}();Vex.Flow.Crescendo=function(){function e(e){arguments.length>0&&this.init(e)}function t(){e.DEBUG&&Vex.L("Vex.Flow.Crescendo",arguments)}function i(e,t){var i=t.begin_x,n=t.end_x,s=t.y,o=t.height/2;e.beginPath(),t.reverse?(e.moveTo(i,s-o),e.lineTo(n,s),e.lineTo(i,s+o)):(e.moveTo(n,s-o),e.lineTo(i,s),e.lineTo(n,s+o)),e.stroke(),e.closePath()}return Vex.Inherit(e,Vex.Flow.Note,{init:function(t){e.superclass.init.call(this,t),this.decrescendo=!1,this.line=t.line||0,this.height=15,Vex.Merge(this.render_options,{extend_left:0,extend_right:0,y_shift:0})},setLine:function(e){return this.line=e,this},setHeight:function(e){return this.height=e,this},setDecrescendo:function(e){return this.decrescendo=e,this},preFormat:function(){return this.preFormatted=!0,this},draw:function(){if(!this.context)throw new Vex.RERR("NoContext","Can't draw Hairpin without a context.");var e,n=this.getTickContext(),s=Vex.Flow.TickContext.getNextContext(n),o=this.getAbsoluteX();e=s?s.getX():this.stave.x+this.stave.width;var h=this.stave.getYForLine(this.line+-3)+1;t("Drawing ",this.decrescendo?"decrescendo ":"crescendo ",this.height,"x",o-e),i(this.context,{begin_x:o-this.render_options.extend_left,end_x:e+this.render_options.extend_right,y:h+this.render_options.y_shift,height:this.height,reverse:this.decrescendo})}}),e}();Vex.Flow.Ornament=function(){function t(t){arguments.length>0&&this.init(t)}function e(){t.DEBUG&&Vex.L("Vex.Flow.Ornament",arguments)}t.CATEGORY="ornaments";var i={n:{shift_x:1,shift_y_upper:0,shift_y_lower:0,height:17},"#":{shift_x:0,shift_y_upper:-2,shift_y_lower:-2,height:20},b:{shift_x:1,shift_y_upper:0,shift_y_lower:3,height:18},"##":{shift_x:0,shift_y_upper:0,shift_y_lower:0,height:12},bb:{shift_x:0,shift_y_upper:0,shift_y_lower:4,height:17},db:{shift_x:-3,shift_y_upper:0,shift_y_lower:4,height:17},bbs:{shift_x:0,shift_y_upper:0,shift_y_lower:4,height:17},d:{shift_x:0,shift_y_upper:0,shift_y_lower:0,height:17},"++":{shift_x:-2,shift_y_upper:-6,shift_y_lower:-3,height:22},"+":{shift_x:1,shift_y_upper:-4,shift_y_lower:-2,height:20}},n=Vex.Flow.Modifier;return t.format=function(t,e){if(!t||0===t.length)return!1;for(var i,n=e.text_line,h=0,o=0;o<t.length;++o){var s=t[o];s.setTextLine(n),i=s.getWidth()>h?s.getWidth():h;var r=Vex.Flow.ornamentCodes(s.type);n+=r.between_lines?1:1.5}return e.left_shift+=i/2,e.right_shift+=i/2,e.text_line=n,!0},Vex.Inherit(t,n,{init:function(e){if(t.superclass.init.call(this),this.note=null,this.index=null,this.type=e,this.position=n.Position.ABOVE,this.delayed=!1,this.accidental_upper="",this.accidental_lower="",this.render_options={font_scale:38},this.ornament=Vex.Flow.ornamentCodes(this.type),!this.ornament)throw new Vex.RERR("ArgumentError","Ornament not found: '"+this.type+"'");this.setWidth(this.ornament.width)},setDelayed:function(t){return this.delayed=t,this},setUpperAccidental:function(t){return this.accidental_upper=t,this},setLowerAccidental:function(t){return this.accidental_lower=t,this},draw:function(){function t(t,e,n){var h=Vex.Flow.accidentalCodes(e),o=w-3,s=u+2;n?(s-=r?r.height:18,s+="tr"===y.type?-8:0):s+="tr"===y.type?-6:0;var r=i[e];r&&(o+=r.shift_x,s+=n?r.shift_y_upper:r.shift_y_lower);var _=y.render_options.font_scale/1.3;Vex.Flow.renderGlyph(t,o,s,_,h.code),n||(u-=r?r.height:18)}if(!this.context)throw new Vex.RERR("NoContext","Can't draw Ornament without a context.");if(!this.note||null===this.index)throw new Vex.RERR("NoAttachedNote","Can't draw Ornament without a note and index.");var n,h,o=this.context,s=this.note.getStemDirection(),r=this.note.getStave(),_=this.note.getStem().getExtents();s===Vex.Flow.StaveNote.STEM_DOWN?(n=_.baseY,h=_.topY):(n=_.topY,h=_.baseY);var a="tabnotes"===this.note.getCategory();a&&(this.note.hasStem()?s===Vex.Flow.StaveNote.STEM_UP?h=r.getYForBottomText(this.text_line-2):s===Vex.Flow.StaveNote.STEM_DOWN&&(n=r.getYForTopText(this.text_line-1.5)):(n=r.getYForTopText(this.text_line-1),h=r.getYForBottomText(this.text_line-2)));var l=s===Vex.Flow.StaveNote.STEM_DOWN,f=r.getSpacingBetweenLines(),x=1;!l&&this.note.beam&&(x+=.5);var p=f*(this.text_line+x),d=n-7-p,c=this.note.getModifierStartXY(this.position,this.index),w=c.x+this.ornament.shift_right,u=Math.min(r.getYForTopText(this.text_line)-3,d);if(u+=this.ornament.shift_up+this.y_shift,this.delayed){w+=this.ornament.width;var g=Vex.Flow.TickContext.getNextContext(this.note.getTickContext());w+=g?.5*(g.getX()-w):.5*(r.x+r.width-w)}var y=this;this.accidental_lower&&t(o,this.accidental_lower,!1,w,u),e("Rendering ornament: ",this.ornament,w,u),Vex.Flow.renderGlyph(o,w,u,this.render_options.font_scale,this.ornament.code),this.accidental_upper&&t(o,this.accidental_upper,!0,w,u)}}),t}();Vex.Flow.PedalMarking=function(){function e(e){arguments.length>0&&this.init(e)}function t(){e.DEBUG&&Vex.L("Vex.Flow.PedalMarking",arguments)}function s(t,s,i,n,o){var r=e.GLYPHS[t],a=new Vex.Flow.Glyph(r.code,o);a.render(s,i+r.x_shift,n+r.y_shift)}return e.GLYPHS={pedal_depress:{code:"v36",x_shift:-10,y_shift:0},pedal_release:{code:"v5d",x_shift:-2,y_shift:3}},e.Styles={TEXT:1,BRACKET:2,MIXED:3},e.createSustain=function(t){var s=new e(t);return s},e.createSostenuto=function(t){var s=new e(t);return s.setStyle(e.Styles.MIXED),s.setCustomText("Sost. Ped."),s},e.createUnaCorda=function(t){var s=new e(t);return s.setStyle(e.Styles.TEXT),s.setCustomText("una corda","tre corda"),s},e.prototype={init:function(e){this.notes=e,this.style=Vex.Flow.PedalMarking.TEXT,this.line=0,this.custom_depress_text="",this.custom_release_text="",this.font={family:"Times New Roman",size:12,weight:"italic bold"},this.render_options={bracket_height:10,text_margin_right:6,bracket_line_width:1,glyph_point_size:40,color:"black"}},setCustomText:function(e,t){return this.custom_depress_text=e||"",this.custom_release_text=t||"",this},setStyle:function(e){if(1>e&&e>3)throw new Vex.RERR("InvalidParameter","The style must be one found in PedalMarking.Styles");return this.style=e,this},setLine:function(e){return this.line=e,this},setContext:function(e){return this.context=e,this},drawBracketed:function(){var t,i,n=this.context,o=!1,r=this;this.notes.forEach(function(a,l,h){o=!o;var _=a.getAbsoluteX(),d=a.getStave().getYForBottomText(r.line+3);if(t>_)throw new Vex.RERR("InvalidConfiguration","The notes provided must be in order of ascending x positions");var c=h[l+1]===a,u=h[l-1]===a,x=0;if(o)if(x=u?5:0,r.style!==e.Styles.MIXED||u)n.beginPath(),n.moveTo(_,d-r.render_options.bracket_height),n.lineTo(_+x,d),n.stroke(),n.closePath();else if(r.custom_depress_text){var f=n.measureText(r.custom_depress_text).width;n.fillText(r.custom_depress_text,_-f/2,d),x=f/2+r.render_options.text_margin_right}else s("pedal_depress",n,_,d,r.render_options.glyph_point_size),x=20+r.render_options.text_margin_right;else x=c?-5:0,n.beginPath(),n.moveTo(t,i),n.lineTo(_+x,d),n.lineTo(_,d-r.render_options.bracket_height),n.stroke(),n.closePath();t=_+x,i=d})},drawText:function(){var e=this.context,t=!1,i=this,n=i.render_options.glyph_point_size;this.notes.forEach(function(o){t=!t;var r=o.getStave(),a=o.getAbsoluteX(),l=r.getYForBottomText(i.line+3),h=0;t?i.custom_depress_text?(h=e.measureText(i.custom_depress_text).width,e.fillText(i.custom_depress_text,a-h/2,l)):s("pedal_depress",e,a,l,n):i.custom_release_text?(h=e.measureText(i.custom_release_text).width,e.fillText(i.custom_release_text,a-h/2,l)):s("pedal_release",e,a,l,n)})},draw:function(){if(!this.context)throw new Vex.RERR("NoContext","Can't draw PedalMarking without a context.");var s=this.context;s.save(),s.setStrokeStyle(this.render_options.color),s.setFillStyle(this.render_options.color),s.setFont(this.font.family,this.font.size,this.font.weight),t("Rendering Pedal Marking"),this.style===e.Styles.BRACKET||this.style===e.Styles.MIXED?(s.setLineWidth(this.render_options.bracket_line_width),this.drawBracketed()):this.style===Vex.Flow.PedalMarking.Styles.TEXT&&this.drawText(),s.restore()}},e}();Vex.Flow.TextBracket=function(){function t(t){arguments.length>0&&this.init(t)}function e(){t.DEBUG&&Vex.L("Vex.Flow.TextBracket",arguments)}return t.Positions={TOP:1,BOTTOM:-1},t.prototype={init:function(e){this.start=e.start,this.stop=e.stop,this.text=e.text||"",this.superscript=e.superscript||"",this.position=e.position||t.Positions.TOP,this.line=1,this.font={family:"Serif",size:15,weight:"italic"},this.render_options={dashed:!0,dash:[5],color:"black",line_width:1,show_bracket:!0,bracket_height:8,underline_superscript:!0}},applyStyle:function(t){return t.setFont(this.font.family,this.font.size,this.font.weight),t.setStrokeStyle(this.render_options.color),t.setFillStyle(this.render_options.color),t.setLineWidth(this.render_options.line_width),this},setDashed:function(t,e){return this.render_options.dashed=t,e&&(this.render_options.dash=e),this},setFont:function(t){return this.font=t,this},setContext:function(t){return this.context=t,this},setLine:function(t){return this.line=t,this},draw:function(){var i=this.context,s=0;switch(this.position){case t.Positions.TOP:s=this.start.getStave().getYForTopText(this.line);break;case t.Positions.BOTTOM:s=this.start.getStave().getYForBottomText(this.line)}var o={x:this.start.getAbsoluteX(),y:s},n={x:this.stop.getAbsoluteX(),y:s};e("Rendering TextBracket: start:",o,"stop:",n,"y:",s);var r=this.render_options.bracket_height*this.position;i.save(),this.applyStyle(i),i.fillText(this.text,o.x,o.y);var h=i.measureText(this.text).width,a=i.measureText("M").width,p=o.y-a/2.5;i.setFont(this.font.family,this.font.size/1.4,this.font.weight),i.fillText(this.superscript,o.x+h+1,p);var d=i.measureText(this.superscript).width,l=i.measureText("M").width,c=o.x,u=p,x=n.x+this.stop.getGlyph().head_width;this.position===t.Positions.TOP?(c+=h+d+5,u-=l/2.7):this.position===t.Positions.BOTTOM&&(u+=l/2.7,c+=h+2,this.render_options.underline_superscript||(c+=d)),this.render_options.dashed?(Vex.Flow.Renderer.drawDashedLine(i,c,u,x,u,this.render_options.dash),this.render_options.show_bracket&&Vex.Flow.Renderer.drawDashedLine(i,x,u+1*this.position,x,u+r,this.render_options.dash)):(i.beginPath(),i.moveTo(c,u),i.lineTo(x,u),this.render_options.show_bracket&&i.lineTo(x,u+r),i.stroke(),i.closePath()),i.restore()}},t}();Vex.Flow.TextDynamics=function(){function e(e){arguments.length>0&&this.init(e)}function t(){e.DEBUG&&Vex.L("Vex.Flow.TextDynamics",arguments)}return e.GLYPHS={f:{code:"vba",width:12},p:{code:"vbf",width:14},m:{code:"v62",width:17},s:{code:"v4a",width:10},z:{code:"v80",width:12},r:{code:"vb1",width:12}},Vex.Inherit(e,Vex.Flow.Note,{init:function(i){e.superclass.init.call(this,i),this.sequence=i.text.toLowerCase(),this.line=i.line||0,this.glyphs=[],Vex.Merge(this.render_options,{glyph_font_size:40}),t("New Dynamics Text: ",this.sequence)},setLine:function(e){return this.line=e,this},preFormat:function(){var t=0;return this.sequence.split("").forEach(function(i){var n=e.GLYPHS[i];if(!n)throw new Vex.RERR("Invalid dynamics character: "+i);var s=this.render_options.glyph_font_size,h=new Vex.Flow.Glyph(n.code,s);this.glyphs.push(h),t+=n.width},this),this.setWidth(t),this.preFormatted=!0,this},draw:function(){var i=this.getAbsoluteX(),n=this.stave.getYForLine(this.line+-3);t("Rendering Dynamics: ",this.sequence);var s=i;this.glyphs.forEach(function(t,i){var h=this.sequence[i];t.render(this.context,s,n),s+=e.GLYPHS[h].width},this)}}),e}();Vex.Flow.GraceNote=function(){var t=function(t){arguments.length>0&&this.init(t)};return Vex.Inherit(t,Vex.Flow.StaveNote,{init:function(e){t.superclass.init.call(this,e),this.render_options.glyph_font_scale=22,this.render_options.stem_height=20,this.render_options.stroke_px=2,this.glyph.head_width=6,this.slash=e.slash,this.slur=!0,this.buildNoteHeads(),this.width=3},getStemExtension:function(){var t=this.getGlyph();return null!=this.stem_extension_override?this.stem_extension_override:t?1===this.getStemDirection()?t.gracenote_stem_up_extension:t.gracenote_stem_down_extension:0},getCategory:function(){return"gracenotes"},draw:function(){t.superclass.draw.call(this);var e=this.context,i=this.getStemDirection();if(this.slash){e.beginPath();var s=this.getAbsoluteX(),n=this.getYs()[0]-this.stem.getHeight()/2.8;1===i?(s+=1,e.lineTo(s,n),e.lineTo(s+13,n-9)):-1===i&&(s-=4,n+=1,e.lineTo(s,n),e.lineTo(s+13,n+9)),e.closePath(),e.stroke()}}}),t}();Vex.Flow.GraceNoteGroup=function(){function t(t,e){arguments.length>0&&this.init(t,e)}return t.CATEGORY="gracenotegroups",t.format=function(t,e){var i=4;if(!t||0===t.length)return!1;var n,o,r,s=[],h=!1,a=null,c=0;for(n=0;n<t.length;++n){o=t[n];var u=o.getNote(),l=u.getStave();if(u!=a){for(var f=0;f<u.keys.length;++f)r=u.getKeyProps()[f],c=r.displaced?u.getExtraLeftPx():c;a=u}null!=l?(h=!0,s.push({shift:c,gracenote_group:o})):s.push({shift:c,gracenote_group:o})}var g=s[0].shift;for(n=0;n<s.length;++n)o=s[n].gracenote_group,o.preFormat(),g=o.getWidth()+i;return e.left_shift+=g,!0},Vex.Inherit(t,Vex.Flow.Modifier,{init:function(e,i){var n=t.superclass;return n.init.call(this),this.note=null,this.index=null,this.position=Vex.Flow.Modifier.Position.LEFT,this.grace_notes=e,this.width=0,this.preFormatted=!1,this.show_slur=i,this.slur=null,this.formatter=new Vex.Flow.Formatter,this.voice=new Vex.Flow.Voice({num_beats:4,beat_value:4,resolution:Vex.Flow.RESOLUTION}).setStrict(!1),this.voice.addTickables(this.grace_notes),this},preFormat:function(){this.preFormatted||(this.formatter.joinVoices([this.voice]).format([this.voice],0),this.setWidth(this.formatter.getMinTotalWidth()),this.preFormatted=!0)},beamNotes:function(){if(this.grace_notes.length>1){var t=new Vex.Flow.Beam(this.grace_notes);t.render_options.beam_width=3,t.render_options.partial_beam_length=4,this.beam=t}return this},setNote:function(t){this.note=t},setWidth:function(t){this.width=t},getWidth:function(){return this.width},setXShift:function(t){this.x_shift=t},draw:function(){function t(t,e){var i=e.getTickContext(),n=i.getExtraPx(),o=i.getX()-n.left-n.extraLeft;t.forEach(function(t){var i=t.getTickContext(),n=i.getX();t.setStave(e.stave),i.setX(o+n)})}if(!this.context)throw new Vex.RuntimeError("NoContext","Can't draw Grace note without a context.");var e=this.getNote();if(!e||null===this.index)throw new Vex.RuntimeError("NoAttachedNote","Can't draw grace note without a parent note and parent note index.");t(this.grace_notes,e),this.grace_notes.forEach(function(t){t.setContext(this.context).draw()},this),this.beam&&this.beam.setContext(this.context).draw(),this.show_slur&&(this.slur=new Vex.Flow.StaveTie({last_note:this.grace_notes[0],first_note:e,first_indices:[0],last_indices:[0]}),this.slur.render_options.cp2=12,this.slur.setContext(this.context).draw())}}),t}();
define("vexflow", ["jquery","raphael"], (function (global) {
    return function () {
        var ret, fn;
        return ret || global.Vex;
    };
}(this)));

// Concerto Base Libraries.
// Taehoon Moon <panarch@kaist.ac.kr>
//
// AttributesManager
//
// Copyright Taehoon Moon 2014

define('AttributesManager',['require','exports','module','vexflow','js-logger','Table'],function(require, exports, module) {
    var Vex = require('vexflow');
    var L = require('js-logger').get('AttributesManager');
    var Table = require('Table');

    /**
     * @constructor
     * @template AttributesManager
     */
    function AttributesManager() {
        this.time = {
            'beats': Table.DEFAULT_TIME_BEATS,
            'beat-type': Table.DEFAULT_TIME_BEAT_TYPE
        };
        this.divisions = 1;
        this.keyDict = {};
        this.clefDict = {};

        this.partIndex = 0;
        this.measureIndex = 0;
    }

    /**
     * @this {AttributesManager}
     * @param {number} part
     * @param {number=} staff
     * @param {string} clef
     */
    AttributesManager.prototype.setClef = function setClef(part, staff, clef) {
        if (this.clefDict[part] === undefined)
            this.clefDict[part] = {};

        if (staff === undefined) {
            staff = 1;
            this.clefDict[part][staff] = clef;
        }
        else
            if (staff === 1) {
                this.clefDict[part][staff] = clef;
                if (this.clefDict[part][2] === undefined)
                    this.clefDict[part][2] = clef;
            }
            else
                this.clefDict[part][staff] = clef;
    };

    /**
     * Converts raw clefs and set.
     * @this {AttributesManager}
     * @param {Array} rawClefs
     * @param {number} part
     */
    AttributesManager.prototype.setClefs = function setClefs(rawClefs, part) {
        if (this.clefDict[part] === undefined)
            this.clefDict[part] = {};

        var changedStaffs = [];

        for (var i = 0; i < rawClefs.length; i++) {
            var rawClef = rawClefs[i];
            var clef = AttributesManager.getVexClef(rawClef);

            if (clef === undefined) {
                L.error('Unsupported clef sign: ' + clef);
                clef = Table.DEFAULT_CLEF;
            }

            var staff;
            if (rawClef['@number'] !== undefined)
                staff = rawClef['@number'];
            else
                staff = 1;

            this.clefDict[part][staff] = clef;
            changedStaffs.push(staff);
        }

        return changedStaffs;
    };

    /**
     * Returns converted clef information.
     * @this {AttributesManager}
     * @param {number} part
     * @param {number=} staff
     * @param {string=} defaultClef
     * @return {string} clef
     */
    AttributesManager.prototype.getClef = function getClef(part, staff, defaultClef) {
        if (staff === undefined)
            staff = 1;

        if (this.clefDict[part] === undefined || this.clefDict[part][staff] === undefined)
            return defaultClef;

        return this.clefDict[part][staff];
    };

    /**
     * @this {AttributesManager}
     * @param {Object} key
     * @param {number} part
     * @param {number=} staff
     */
    AttributesManager.prototype.setKeySignature = function setKeySignature(key, part, staff) {
        if (staff === undefined)
            staff = 1;

        if (this.keyDict[part] === undefined)
            this.keyDict[part] = {};

        this.keyDict[part][staff] = key;
    };

    /**
     * @this {AttributesManager}
     * @param {number} part
     * @param {number=} staff
     * @return {Object}
     */
    AttributesManager.prototype.getKeySignature = function getKeySignature(part, staff) {
        if (staff === undefined)
            staff = 1;

        return this.keyDict[part][staff];
    };

    /**
     * @this {AttributesManager}
     * @param {number} divisions
     */
    AttributesManager.prototype.setDivisions = function setDivisions(divisions) {
        this.divisions = divisions;
    };

    /**
     * @this {AttributesManager}
     * @return {number}
     */
    AttributesManager.prototype.getDivisions = function getDivisions() {
        return this.divisions;
    };

    /**
     * @this {AttributesManager}
     * @param {Object.<string, number>} time
     */
    AttributesManager.prototype.setTimeSignature = function setTimeSignature(time) {
        this.time = time;
    };

    /**
     * @this {AttributesManager}
     * @return {Object.<string, number>}
     */
    AttributesManager.prototype.getTimeSignature = function getTimeSignature() {
        return this.time;
    };

    /**
     * @this {AttributesManager}
     * @param {number} partIndex
     */
    AttributesManager.prototype.setPartIndex = function setPartIndex(partIndex) {
        this.partIndex = partIndex;
    };

    /**
     * @this {AttributesManager}
     * @param {number} measureIndex
     */
    AttributesManager.prototype.setMeasureIndex = function setMeasureIndex(measureIndex) {
        this.measureIndex = measureIndex;
    };

    // static functions

    /**
     * @param {Object} stave
     * @param {string} clef
     * @param {string} defaultClef
     */
    AttributesManager.addClefToStave = function addClefToStave(stave, clef) {
        //if (clef === undefined) {}
    };

    /**
     * @param {Object} stave
     * @param {Object} keyDict
     */
    AttributesManager.addKeySignatureToStave = function addKeySignatureToStave(stave, keyDict, clef) {
        if (keyDict['fifths'] === undefined) {
            L.error('key fifths does not exists');
            return;
        }

        if (clef)
            stave.clef = clef;

        var fifths = keyDict['fifths'];
        var keySpec;

        if (fifths === 0)
            keySpec = 'C';
        else if (fifths > 0)
            keySpec = Table.SHARP_MAJOR_KEY_SIGNATURES[fifths - 1];
        else
            keySpec = Table.FLAT_MAJOR_KEY_SIGNATURES[-fifths - 1];

        stave.addKeySignature(keySpec);
    };

    /**
     * @param {Object} stave
     * @param {Object} timeDict
     */
    AttributesManager.addTimeSignatureToStave = function addTimeSignatureToStave(stave, timeDict) {
        var timeSpec;
        if (timeDict['@symbol'])
            if (timeDict['@symbol'] === 'common')
                timeSpec = 'C';
            else if (timeDict['@symbol'] === 'cut')
                timeSpec = 'C|';
            else {
                L.warn('Unsupported time symbol');
                timeSpec = 'C';
            }
        else
            timeSpec = timeDict['beats'] + '/' + timeDict['beat-type'];

        stave.addTimeSignature(timeSpec);
    };

    /**
     * @param {Array.<Object>} staves
     * @param {Array.<Object>} rawClefs
     */
    AttributesManager.addEndClefToStave = function addEndClefToStave(staves, rawClefs) {
        for (var i = 0; i < rawClefs.length; i++) {
            var rawClef = rawClefs[i];
            var clef = AttributesManager.getVexClef(rawClef);
            clef += '_small';
            if (rawClef['@number'] === 1)
                staves[0].addEndClef(clef);
            else
                staves[1].addEndClef(clef);
        }
    };

    /**
     * @param {Array.<Object>} rawClefs
     * @return {Object} clefNote;
     */
    AttributesManager.getClefNote = function getClefNote(rawClefs) {
        var clef = AttributesManager.getVexClef(rawClefs[0]);
        clef += '_small';
        var clefNote = new Vex.Flow.ClefNote(clef);
        return clefNote;
    };

    /**
     * @param {Object} rawClef
     * @return {string} clef
     */
    AttributesManager.getVexClef = function getVexClef(rawClef) {
        var clefKey = rawClef['sign'] + '/' + rawClef['line'];
        var clef = Table.CLEF_TYPE_DICT[clefKey];
        return clef;
    };

    module.exports = AttributesManager;
});

// Concerto Base Libraries.
// Taehoon Moon <panarch@kaist.ac.kr>
//
// MeasureManager
//
// Copyright Taehoon Moon 2014

define('MeasureManager',['require','exports','module'],function(require, exports, module) {
    /**
     * @constructor
     * @template MeasureManager
     */
    function MeasureManager(musicjson) {
        this.parts = musicjson['part'];
        this.pageLayout = musicjson['defaults']['page-layout'];
        // first measure on same line.
        this.firstMeasures = new Array(this.parts.length);
        this.partIndex = 0;
        this.measureIndex = 0;
    }

    /**
     * @this {MeasureManager}
     * @param {number} partIndex
     */
    MeasureManager.prototype.setPartIndex = function setPartIndex(partIndex) {
        this.partIndex = partIndex;
        var measure = this.parts[this.partIndex]['measure'][this.measureIndex];
        if (measure['print'])
            this.firstMeasures[this.partIndex] = measure;
    };

    /**
     * @this {MeasureManager}
     * @param {number} measureIndex
     */
    MeasureManager.prototype.setMeasureIndex = function setMeasureIndex(measureIndex) {
        this.measureIndex = measureIndex;
    };

    /**
     * @this {MeasureManager}
     * @param {number=} partIndex
     * @return {Object}
     */
    MeasureManager.prototype.getFirstMeasure = function getFirstMeasure(partIndex) {
        if (partIndex === undefined)
            partIndex = this.partIndex;

        return this.firstMeasures[partIndex];
    };

    /**
     * @this {MeasureManager}
     * @return {Object=}
     */
    MeasureManager.prototype.getLeftMeasure = function getLeftMeasure() {
        var measure = this.parts[this.partIndex]['measure'][this.measureIndex];
        if (measure['print'] &&
            (measure['print']['@new-page'] || measure['print']['@new-system']))
            return undefined;

        return this.parts[this.partIndex]['measure'][this.measureIndex - 1];
    };

    /**
     * @this {MeasureManager}
     * @return {Object}
     */
    MeasureManager.prototype.getAboveMeasure = function getAboveMeasure() {
        if (this.partIndex === 0) {
            //var i = this.measureIndex - 1;
            var firstMeasure = this.getFirstMeasure(this.partIndex);
            if (firstMeasure['print']['system-layout']['top-system-distance'] !== undefined) // firstMeasure['print']['@new-page']
                return undefined;

            // @new-system
            return this.parts[this.parts.length - 1]['measure'][this.measureIndex - 1];
        }

        return this.parts[this.partIndex - 1]['measure'][this.measureIndex];
    };

    module.exports = MeasureManager;
});

// Concerto Base Libraries.
// Taehoon Moon <panarch@kaist.ac.kr>
//
// LayoutManager
//
// Copyright Taehoon Moon 2014

define('LayoutManager',['require','exports','module','vexflow','js-logger','Table'],function(require, exports, module) {
    var Vex = require('vexflow');
    var L = require('js-logger').get('LayoutManager');
    var Table = require('Table');

    /**
     * @constructor
     * @template LayoutManager
     */
     function LayoutManager(musicjson) {
        this.page = 1;
        this.parts = musicjson['part'];
        this.pageLayout = musicjson['defaults']['page-layout'];
        this.leftMargin = 0;
    }

    /**
     * @this {LayoutManager}
     * @param {number} page
     * @return {Object}
     */
    LayoutManager.prototype.getPageMargins = function getPageMargins() {
        if (Array.isArray(this.pageLayout['page-margins']) === false)
            return this.pageLayout['page-margins'];
        else if (this.pageLayout['page-margins'].length === 1) // both
            return this.pageLayout['page-margins'][0];

        var pageType = (this.page % 2 === 1) ? 'odd' : 'even';
        for (var i = 0; i < this.pageLayout['page-margins'].length; i++)
            if (this.pageLayout['page-margins'][i]['@type'] === pageType)
                return this.pageLayout['page-margins'][i];

        L.error('page-margins required');
        return {};
    };

    /**
     * @this {LayoutManager}
     * @param {number} pageIndex
     */
    LayoutManager.prototype.setPageIndex = function setPageIndex(pageIndex) {
        this.page = pageIndex + 1;
    };

    /**
     * @this {LayoutManager}
     * @param {Object} measure
     * @param {Object} leftMeasure
     * @param {Object} aboveMeasure
     * @param {Object} firstMeasure
     * @return {Array}
     */
    LayoutManager.prototype.getStavePositions = function getStavePositions(measure, leftMeasure, aboveMeasure, firstMeasure) {
        var positions = [];
        var pageMargins = this.getPageMargins();
        var position;
        var print;

        if (leftMeasure) {
            measure['y'] = leftMeasure['y'];
            measure['x'] = leftMeasure['x'] + leftMeasure['width'];
            position = {
                'x': measure['x'],
                'y': measure['y']
            };
            positions.push(position);
        }
        else {
            print = measure['print'];
            measure['x'] = pageMargins['left-margin'];
            if (print['system-layout']) {
                var systemLayout = print['system-layout'];
                if (systemLayout['system-margins'] &&
                    systemLayout['system-margins']['left-margin'])
                    this.leftMargin = systemLayout['system-margins']['left-margin'];
                else
                    this.leftMargin = 0;

                if (systemLayout['top-system-distance'] !== undefined) {
                    // new page
                    var topMargin = pageMargins['top-margin'];
                    measure['y'] = topMargin + systemLayout['top-system-distance'];
                }
                else if (systemLayout['system-distance'] !== undefined) // new system
                    measure['y'] = aboveMeasure['bottom-line-y'] + systemLayout['system-distance'];
                else
                    L.error('Unhandled layout state');
            }
            else if (print['staff-layout'].length > 0) // new system, staff
                measure['y'] = aboveMeasure['bottom-line-y'] + print['staff-layout'][0]['staff-distance'];
            else
                L.error('Lack of print tag');

            measure['x'] += this.leftMargin;
            position = {
                'x': measure['x'],
                'y': measure['y']
            };
            positions.push(position);
        }

        // check first measure's print
        print = firstMeasure['print'];
        //if (print['staff-layout'] && print['staff-layout']['@number'] == 2) {
        if (!print['staff-layout'])
            return positions;

        var staffDistance;
        if (print['staff-layout'].length > 1)
            staffDistance = print['staff-layout'][1]['staff-distance'];
        else if (print['system-layout'] && print['staff-layout'].length > 0)
            staffDistance = print['staff-layout'][0]['staff-distance'];
        else {
            L.error('Wrong staff-layout.');
            return positions;
        }

        var y = measure['y'] + 40 + staffDistance;
        position = {
            'x': measure['x'],
            'y': y
        };
        measure['y2'] = y;
        positions.push(position);

        return positions;
    };

    /**
     * @this {LayoutManager}
     * @param {Object} measure
     * @param {Object} leftMeasure
     * @param {Object} aboveMeasure
     * @param {Object} firstMeasure
     * @return {Array}
     */
    LayoutManager.prototype.getStaves = function getStaves(measure, leftMeasure, aboveMeasure, firstMeasure) {
        var positions = this.getStavePositions(measure, leftMeasure, aboveMeasure, firstMeasure);

        var staves = [];
        for (var i = 0; i < positions.length; i++) {
            var position = positions[i];
            var stave = new Vex.Flow.Stave(position['x'], position['y'],
                                measure['width'], Table.STAVE_DEFAULT_OPTIONS);
            staves.push(stave);
        }

        return staves;
    };

    module.exports = LayoutManager;
});

// Concerto Base Libraries.
// Taehoon Moon <panarch@kaist.ac.kr>
//
// NoteManager
//
// Copyright Taehoon Moon 2014

define('NoteManager',['require','exports','module','vexflow','js-logger','Table'],function(require, exports, module) {
    var Vex = require('vexflow');
    var L = require('js-logger').get('NoteManager');
    var Table = require('Table');

    /**
     * @constructor
     * @template NoteManager
     */
    function NoteManager(attributesManager) {
        this.duration = 0;
        this.attributesManager = attributesManager;
        this.notes = [];
        this.notesList = [this.notes];
        this.staffList = [];
        this.staffUndecided = true;
    }

    /**
     * @this {NoteManager}
     * @param {Object} staveNote
     * @param {Object} note
     */
    NoteManager.prototype.addStaveNote = function addStaveNote(staveNote, note) {
        var duration = note['duration'];
        //var voice = note['voice'];
        var staff = note['staff'];

        if (staff === undefined)
            staff = 1;

        if (this.staffUndecided) {
            this.staffList.push(staff);
            this.staffUndecided = false;
        }
        this.duration += duration;
        this.notes.push(staveNote);

    };

    /**
     * @this {NoteManager}
     * @param {Object} clefNote
     * @param {Object} note
     */
    NoteManager.prototype.addClefNote = function addClefNote(clefNote, note) {
        this.notes.push(clefNote);
    };

    /**
     * @this {NoteManager}
     * @param {number} duration
     */
    NoteManager.prototype.addBackup = function addBackup(duration) {
        var divisions = this.attributesManager.getDivisions();
        this.staffUndecided = true;
        this.duration -= duration;
        this.notes = [];
        if (this.duration > 0) {
            // if back appears, it means change of voice.
            var noteType = NoteManager.getStaveNoteTypeFromDuration(this.duration, divisions);
            var ghostNote = new Vex.Flow.GhostNote({ duration: noteType });
            this.notes.push(ghostNote);
        }

        this.notesList.push(this.notes);
    };

    /**
     * @this {NoteManager}
     * @param {number} duration
     */
    NoteManager.prototype.addForward = function addForward(duration) {
        var divisions = this.attributesManager.getDivisions();
        this.duration += duration;
        var noteType = NoteManager.getStaveNoteTypeFromDuration(duration, divisions);
        var ghostNote = new Vex.Flow.GhostNote({ duration: noteType });
        this.notes.push(ghostNote);
    };

    /**
     * @this {NoteManager}
     * @param {Object} time
     * @param {Object[]} notes
     */
    NoteManager.prototype.fillVoice = function fillVoice(time, notes) {
        var divisions = this.attributesManager.getDivisions();
        var maxDuration = divisions * 4 / time['beat-type'] * time['beats'];

        var duration = 0;
        for (var i = 0; i < notes.length; i++) {
            var staveNote = notes[i];
            duration += NoteManager.getDurationFromStaveNote(staveNote, divisions);
        }

        duration = maxDuration - duration;
        if (duration < 0) {
            L.warn('Sum of duration exceeds time sig');
            return;
        }
        else if (duration === 0)
            return;

        var noteType = NoteManager.getStaveNoteTypeFromDuration(duration, divisions);
        var ghostNote = new Vex.Flow.GhostNote({ duration: noteType });
        notes.push(ghostNote);
    };

    /**
     * @this {Array.<Object>}
     * @return {Array}
     */
    NoteManager.prototype.getVoices = function getVoices(staves) {
        var voices = [];
        var preStaff = this.staffList[0];
        var staffVoices = [];
        var stave;
        var time = this.attributesManager.getTimeSignature();
        var formatter;
        for (var i = 0; i < this.notesList.length; i++) {
            var staff = this.staffList[i];
            stave = staves[staff - 1];

            var notes = this.notesList[i];
            if (notes.length === 0)
                continue;

            var voice = new Vex.Flow.Voice({ num_beats: time['beats'],
                                            beat_value: time['beat-type'],
                                            resolution: Vex.Flow.RESOLUTION});
            voice.setMode(Vex.Flow.Voice.Mode.SOFT);
            this.fillVoice(time, notes);
            voice = voice.addTickables(notes);
            voices.push([voice, stave]);
            if (preStaff !== staff) {
                _format(staffVoices, stave);
                staffVoices = [voice];
                preStaff = staff;
            }
            else
                staffVoices.push(voice);
        }

        if (staffVoices.length > 0)
            _format(staffVoices, stave);

        function _format(staffVoices, stave) {
            var options = {};
            if (staffVoices.length > 1)
                options.align_rests = true;
            else
                options.align_rests = false;

            formatter = new Vex.Flow.Formatter();
            formatter.joinVoices(staffVoices);
            formatter.formatToStave(staffVoices, stave, options);
        }

        return voices;
    };

    // static functions

    /**
     * @param {Object} staveNote
     * @param {number} divisions
     * @return {number}
     */
    NoteManager.getDurationFromStaveNote = function getDurationFromStaveNote(staveNote, divisions) {
        var noteType = staveNote.getDuration();
        var numDots;
        if (staveNote['-concerto-num-dots'])
            numDots = staveNote['-concerto-num-dots'];
        else
            numDots = 0;

        var index = Table.NOTE_VEX_TYPES.indexOf(noteType);
        var offset = index - Table.NOTE_VEX_QUARTER_INDEX;
        var duration = Math.pow(2, offset) * divisions;
        duration = duration * 2 - duration * Math.pow(2, -numDots);

        return duration;
    };

    /**
     * @param {number} duration
     * @param {number} divisions
     * @param {boolean=} withDots
     */
    NoteManager.getStaveNoteTypeFromDuration = function getStaveNoteTypeFromDuration(duration, divisions, withDots) {
        if (withDots === undefined)
            withDots = false;

        var i = Table.NOTE_VEX_QUARTER_INDEX;
        var count;
        var num;
        for (count = 0; count < 20; count++) {
            num = Math.floor(duration / divisions);
            if (num === 1)
                break;
            else if (num > 1) {
                divisions *= 2;
                i++;
            }
            else {
                divisions /= 2;
                i--;
            }
        }
        if (count === 20)
            L.error('No proper StaveNote type');

        var noteType = Table.NOTE_VEX_TYPES[i];
        if (withDots)
            for (count = 0; count < 5; count++) {
                duration -= Math.floor(duration / divisions);
                divisions /= 2;
                num = Math.floor(duration / divisions);
                if (num === 1)
                    noteType += 'd';
                else
                    break;
            }

        return noteType;
    };

    /**
     * @param {Object} staveNote
     * @param {Object} note
     */
    NoteManager.addTechnicalToStaveNote = function addTechnicalToStaveNote(staveNote, note) {
        var notationsDict = note['notations'];
        if (!notationsDict['technical'])
            return;

        for (var i = 0; i < notationsDict['technical'].length; i++) {
            var item = notationsDict['technical'][i];
            var technicalSymbol;

            switch (item['tag']) {
                case 'down-bow':
                    technicalSymbol = 'am';
                    break;
                case 'up-bow':
                    technicalSymbol = 'a|';
                    break;
                case 'snap-pizzicato':
                    technicalSymbol = 'ao';
                    break;
                default:
                    L.warn('Unhandled technical symbol');
                    break;
            }

            if (technicalSymbol !== undefined) {
                var technical = new Vex.Flow.Articulation(technicalSymbol);
                if (note['stem'] === 'up')
                    technical.setPosition(Vex.Flow.Modifier.Position.ABOVE);
                else
                    technical.setPosition(Vex.Flow.Modifier.Position.BELOW);
                staveNote.addArticulation(0, technical);
            }
        }
    };

    /**
     * @param {Object} staveNote
     * @param {Object} note
     */
    NoteManager.addArticulationToStaveNote = function addArticulationToStaveNote(staveNote, note) {
        var notationsDict = note['notations'];
        if (!notationsDict['articulations'])
            return;

        for (var i = 0; i < notationsDict['articulations'].length; i++) {
            var item = notationsDict['articulations'][i];
            var articulationSymbol;

            switch (item['tag']) {
                case 'accent':
                    articulationSymbol = 'a>';
                    break;
                case 'staccato':
                    articulationSymbol = 'a.';
                    break;
                case 'tenuto':
                    articulationSymbol = 'a-';
                    break;
                case 'strong-accent': // marcato, currently only supports up marcato
                    articulationSymbol = 'a^';
                    break;
                default:
                    L.warn('Unhandled articulations symbol');
                    break;
            }

            if (articulationSymbol !== undefined) {
                var articulation = new Vex.Flow.Articulation(articulationSymbol);
                if (note['stem'] === 'up')
                    articulation.setPosition(Vex.Flow.Modifier.Position.ABOVE);
                else
                    articulation.setPosition(Vex.Flow.Modifier.Position.BELOW);
                staveNote.addArticulation(0, articulation);
            }
        }
    };

    /**
     * @param {Array.<Object>} notes
     * @param {string} clef
     * @param {number} divisions
     */
    NoteManager.getStaveNote = function getStaveNote(notes, clef, divisions) {
        var keys = [];
        var accidentals = [];
        var baseNote = notes[0];
        var duration;
        var i;

        if (baseNote['type'] !== undefined)
            duration = Table.NOTE_TYPE_DICT[baseNote['type']];
        else
            duration = NoteManager.getStaveNoteTypeFromDuration(baseNote['duration'], divisions);

        if (notes.length === 1 && baseNote['rest']) {
            duration += 'r';
            keys.push(Table.DEFAULT_REST_PITCH);
            clef = undefined;
        }
        else // compute keys
            for (i = 0; i < notes.length; i++) {
                var note = notes[i];
                var key = note['pitch']['step'].toLowerCase();
                if (note['accidental']) {
                    var accidental = Table.ACCIDENTAL_DICT[ note['accidental'] ];
                    key += accidental;
                    accidentals.push(accidental);
                }
                else
                    accidentals.push(false);

                key += '/' + note['pitch']['octave'];
                keys.push(key);
            }

        if (baseNote['dot'])
            for (i = 0; i < baseNote['dot']; i++)
                duration += 'd';

        var staveNote = new Vex.Flow.StaveNote({ keys: keys, duration: duration, clef: clef });

        for (i = 0; i < accidentals.length; i++)
            if (accidentals[i])
                staveNote.addAccidental(i, new Vex.Flow.Accidental(accidentals[i]));

        staveNote['-concerto-num-dots'] = baseNote['dot'];

        if (baseNote['dot'])
            for (i = 0; i < baseNote['dot']; i++)
                staveNote.addDotToAll();

        if (baseNote['stem'] === 'up')
            staveNote.setStemDirection(Vex.Flow.StaveNote.STEM_DOWN);

        // notations
        if (baseNote['notations'] !== undefined) {
            var notationsDict = baseNote['notations'];

            // fermata
            if (notationsDict['fermata'] !== undefined) {
                var fermataType = notationsDict['fermata']['@type'];
                if (fermataType === 'upright')
                    staveNote.addArticulation(0,
                        new Vex.Flow.Articulation('a@a').setPosition(Vex.Flow.Modifier.Position.ABOVE));
                else if (fermataType === 'inverted')
                    staveNote.addArticulation(0,
                        new Vex.Flow.Articulation('a@u').setPosition(Vex.Flow.Modifier.Position.BELOW));
                else
                    L.error('Unhandled fermata type.');
            }

            // technical
            NoteManager.addTechnicalToStaveNote(staveNote, baseNote);

            // articulations
            NoteManager.addArticulationToStaveNote(staveNote, baseNote);
        }

        return staveNote;
    };

    module.exports = NoteManager;
});

// Concerto Base Libraries.
// Taehoon Moon <panarch@kaist.ac.kr>
//
// BarlineManager
//
// Copyright Taehoon Moon 2014

define('BarlineManager',['require','exports','module','vexflow','js-logger'],function(require, exports, module) {
    var Vex = require('vexflow');
    var L = require('js-logger').get('BarlineManager');

    function BarlineManager() {}

    /**
     * @param {Object} barline
     * @param {boolean} isLeft
     * @return {number}
     */
    BarlineManager.getBarlineType = function getBarlineType(barline, isLeft) {
        if (barline['repeat'])
            if (isLeft)
                return Vex.Flow.Barline.type.REPEAT_BEGIN;
            else
                return Vex.Flow.Barline.type.REPEAT_END;

        if (barline['bar-style'] === 'light-light')
            return Vex.Flow.Barline.type.DOUBLE;
        else if (barline['bar-style'] === 'light-heavy')
            return Vex.Flow.Barline.type.END;

        L.warn('Unhandled barline style : ' + barline['bar-style']);
        // default barline
        return Vex.Flow.Barline.type.SINGLE;
    };

    /**
     * @param {Object} stave
     * @param {object} barlineDict
     */
    BarlineManager.addBarlineToStave = function addBarlineToStave(stave, barlineDict) {
        var barlineType;
        if (barlineDict['left-barline']) {
            var leftBarline = barlineDict['left-barline'];
            barlineType = BarlineManager.getBarlineType(leftBarline, true);
            stave.setBegBarType(barlineType);
        }

        if (barlineDict['right-barline']) {
            var rightBarline = barlineDict['right-barline'];
            barlineType = BarlineManager.getBarlineType(rightBarline, false);
            stave.setEndBarType(barlineType);
        }
    };

    module.exports = BarlineManager;
});

// Concerto Base Libraries.
// Taehoon Moon <panarch@kaist.ac.kr>
//
// Parser
//
// Copyright Taehoon Moon 2014

define('Parser',['require','exports','module','jquery','vexflow','js-logger','AttributesManager','LayoutManager','NoteManager','MeasureManager','BarlineManager','Table'],function(require, exports, module) {
    var $ = require('jquery');
    var Vex = require('vexflow');
    var L = require('js-logger').get('Parser');
    var AttributesManager = require('AttributesManager');
    var LayoutManager = require('LayoutManager');
    var NoteManager = require('NoteManager');
    var MeasureManager = require('MeasureManager');
    var BarlineManager = require('BarlineManager');
    var Table = require('Table');

    function Parser() {}

    /*
     musicjson --> vexflow
    */

    /**
     * @param {Object} musicjson
     * @return {integer}
     */
    Parser.getNumPages = function getNumPages(musicjson) {
        var measures = musicjson['part'][0]['measure'];
        var num = 1;
        for (var i = 0; i < measures.length; i++) {
            var measure = measures[i];
            if (measure['print'] && measure['print']['@new-page'])
                num++;
        }

        return num;
    };

    /**
     * @param {Object} musicjson
     * @return {Object.<string, number>}
     */
    Parser.getPageSize = function getPageSize(musicjson) {
        var pageLayout = musicjson['defaults']['page-layout'];
        $('#content').css('width', pageLayout['page-width'])
                     .css('height', pageLayout['page-height']);
        $('#content').find('svg').remove();
        return {
            width: pageLayout['page-width'],
            height: pageLayout['page-height']
        };
    };

    /**
     * @param {Array} notes
     * @return {Array}
     */
    Parser.getBeams = function getBeams(notes) {
        var beams = [];
        var temps = [];
        var note;
        for (var i = 0; i < notes.length; i++) {
            note = notes[i];
            if (!note['beam'])
                continue;

            var beamText = note['beam'][0]['text'];
            if (beamText === 'begin' || beamText === 'continue')
                temps.push(note['staveNote']);
            else if (beamText === 'end') {
                temps.push(note['staveNote']);
                var beam = new Vex.Flow.Beam(temps);
                temps = [];
                beams.push(beam);
            }
        }

        return beams;
    };

    /**
     * @param {Array} voices
     * @param {Object} ctx
     */
    Parser.drawVoices = function drawVoices(voices, ctx) {
        if (voices.length === 0)
            return;

        var _voices = [];
        var stave = voices[0][1];
        //var justifyWidth = stave.getNoteEndX() - stave.getNoteStartX() - 10;

        var i;

        for (i = 0; i < voices.length; i++)
            _voices.push(voices[i][0]);

        //var formatter = new Vex.Flow.Formatter();
        //formatter.joinVoices(_voices).format(_voices, justifyWidth, { align_rests: false });

        for (i = 0; i < voices.length; i++) {
            var voice = voices[i][0];
            stave = voices[i][1];
            voice.draw(ctx, stave);
        }
    };

    /**
     * @param {Array} pages
     * @param {Object} musicjson
     * @return {Object}
     */
    Parser.parseAndDraw = function parseAndDraw(pages, musicjson) {
        L.debug('Begin parsing & drawing');
        var parts = musicjson['part'];

        var attributesManager = new AttributesManager();
        var layoutManager = new LayoutManager(musicjson);
        var measureManager = new MeasureManager(musicjson);

        var numMeasures = parts[0]['measure'].length;

        var staves;
        var voices;
        var beams;
        var curPageIndex = 0;
        layoutManager.setPageIndex(curPageIndex);

        var divisions = 1;
        var ctx = pages[curPageIndex];
        var p;
        var i;
        var j;
        var k;

        for (i = 0; i < numMeasures; i++) {
            measureManager.setMeasureIndex(i);
            attributesManager.setMeasureIndex(i);
            staves = [];
            beams = [];
            voices = [];
            for (p = 0; p < parts.length; p++) {
                measureManager.setPartIndex(p);
                attributesManager.setPartIndex(p);
                var measure = parts[p]['measure'][i];
                if (measure['print'] && measure['print']['@new-page']) {
                    curPageIndex++;
                    layoutManager.setPageIndex(curPageIndex);
                    ctx = pages[curPageIndex];
                }

                var firstMeasure = measureManager.getFirstMeasure();
                var leftMeasure = measureManager.getLeftMeasure();
                var aboveMeasure = measureManager.getAboveMeasure();

                var curStaves = layoutManager.getStaves(measure, leftMeasure, aboveMeasure, firstMeasure);
                staves = staves.concat(curStaves);
                var stave = curStaves[0];
                var stave2 = curStaves[1];

                measure['stave'] = stave;
                measure['stave2'] = stave2;

                // barlines
                BarlineManager.addBarlineToStave(stave, measure['barline']);
                if (stave2)
                    BarlineManager.addBarlineToStave(stave2, measure['barline']);

                //var staveNotesDict = {};

                // check clef, time signature changes
                var notes = measure['note'];
                var noteManager = new NoteManager(attributesManager);
                var note;
                var clef;

                var clefExists = false;
                var changedStaffs;
                var isAttributes = false;
                if (notes.length > 0) {
                    note = notes[0];
                    isAttributes = (note['tag'] === 'attributes');
                    if (isAttributes && note['clef']) {
                        // set raw clefs, and get converted clef
                        changedStaffs = attributesManager.setClefs(note['clef'], p);
                        clefExists = true;
                    }
                }

                if (measure['print'] || clefExists)
                    for (k = 0; k < curStaves.length; k++) {
                        var staff = k + 1;
                        if (changedStaffs.indexOf(staff) === -1)
                            continue;

                        clef = attributesManager.getClef(p, staff);
                        if (clef !== undefined)
                            curStaves[k].addClef(clef);
                    }

                if (isAttributes > 0) {
                    if (note['key']) {
                        attributesManager.setKeySignature(note['key'], p, note['staff']);
                        var _clef = attributesManager.getClef(p, 1, 'treble');
                        AttributesManager.addKeySignatureToStave(stave, note['key'], _clef);
                        if (stave2) {
                            _clef = attributesManager.getClef(p, 2, 'treble');
                            AttributesManager.addKeySignatureToStave(stave2, note['key'], _clef);
                        }
                    }

                    if (note['time']) {
                        attributesManager.setTimeSignature(note['time']);
                        AttributesManager.addTimeSignatureToStave(stave, note['time']);
                        if (stave2)
                            AttributesManager.addTimeSignatureToStave(stave2, note['time']);
                    }

                    if (note['divisions']) {
                        attributesManager.setDivisions(note['divisions']);
                        divisions = note['divisions'];
                    }
                }

                for (j = 0; j < notes.length; j++) {
                    note = notes[j];
                    // backup, forward
                    if (j > 0 && note['tag'] === 'attributes' && note['clef']) {
                        // clef change,
                        attributesManager.setClefs(note['clef'], p);

                        if (notes[j + 1] === undefined)
                            AttributesManager.addEndClefToStave(curStaves, note['clef']);
                        else {
                            var clefNote = AttributesManager.getClefNote(note['clef']);
                            noteManager.addClefNote(clefNote, note);
                        }
                    }
                    else if (note['tag'] === 'note') {
                        var chordNotes = [note];
                        for (k = j + 1; k < notes.length; k++) {
                            var nextNote = notes[k];
                            if (!nextNote['chord'])
                                break;
                            else
                                j++;
                            chordNotes.push(nextNote);
                        }

                        clef = attributesManager.getClef(p, note['staff'], Table.DEFAULT_CLEF);
                        var staveNote;
                        if (note['staff'] && note['staff'] === 2) {
                            staveNote = NoteManager.getStaveNote(chordNotes, clef, divisions);
                            noteManager.addStaveNote(staveNote, note);
                        }
                        else {
                            staveNote = NoteManager.getStaveNote(chordNotes, clef, divisions);
                            noteManager.addStaveNote(staveNote, note);
                        }

                        note['staveNote'] = staveNote;
                    }
                    else if (note['tag'] === 'backup')
                        noteManager.addBackup(note['duration']);
                    else if (note['tag'] === 'forward')
                        noteManager.addForward(note['duration']);
                }

                var newBeams = Parser.getBeams(notes);
                beams = beams.concat(newBeams);
                var newVoices = noteManager.getVoices(curStaves);
                voices = voices.concat(newVoices);

                // draw stave
                if (ctx === undefined)
                    continue;

                stave.setContext(ctx).draw();
                measure['top-line-y'] = stave.getYForLine(0) + 1;
                measure['top-y'] = stave.y;
                measure['bottom-line-y'] = stave.getYForLine(stave.options.num_lines - 1) + 1;
                measure['bottom-y'] = stave.getBottomY();
                if (stave2) {
                    //stave2.y = measure['bottom-line-y'] + measure['print']['staff-layout']['staff-distance'];
                    stave2.setContext(ctx).draw();
                    measure['bottom-line-y'] = stave2.getYForLine(stave2.options.num_lines - 1) + 1;
                    measure['bottom-y'] = stave2.getBottomY();
                }
            }

            if (ctx === undefined)
                continue;

            // does vexflow not support multiple part formatting?
            Parser.drawVoices(voices, ctx);

            for (j = 0; j < beams.length; j++)
                beams[j].setContext(ctx).draw();

            // draw stave connector
            // current version, multiple staff and connector shape are not supported.
            if (parts[0]['measure'][i]['print']) {
                var staveConnector = new Vex.Flow.StaveConnector(staves[0], staves[staves.length - 1]);
                staveConnector.setContext(ctx);
                staveConnector.setType(Vex.Flow.StaveConnector.type.BRACE);
                staveConnector.draw();
                staveConnector.setType(Vex.Flow.StaveConnector.type.SINGLE);
                staveConnector.draw();
            }
        }

        L.debug('Finished');
        return musicjson;
    };

    module.exports = Parser;
});

// Concerto Base Libraries.
// Taehoon Moon <panarch@kaist.ac.kr>
//
// Renderer
//
// Copyright Taehoon Moon 2014

define('Renderer',['require','exports','module','jquery','vexflow','Parser'],function(require, exports, module) {
    var $ = require('jquery');
    var Vex = require('vexflow');
    var Parser = require('Parser');

    /**
     * @constructor
     * @template Concerto.Renderer
     */
    function Renderer($container, musicjson, options) {
        this.backends = Vex.Flow.Renderer.Backends.RAPHAEL;
        if (options && options.backends)
            this.backends = options.backends;

        this.$container = $container;

        this.numPages = Parser.getNumPages(musicjson);
        this.pages = [];
        this.doms = [];
        this.pageSize = Parser.getPageSize(musicjson);
        for (var i = 0; i < this.numPages; i++)
            this.addPage();

        this.musicjson = musicjson;
    }

    /**
     * @this {Concerto.Renderer}
     */
    Renderer.prototype.addPage = function addPage() {
        var $div = $('<div>');

        $div.css('width', this.pageSize.width)
            .css('height', this.pageSize.height);

        $div.addClass('concerto-page');

        this.$container.append($div);

        var vexflowRenderer = new Vex.Flow.Renderer($div[0], this.backends);
        var ctx = vexflowRenderer.getContext();
        this.pages.push(ctx);
        this.doms.push($div);
    };

    /**
     * @this {Concerto.Renderer}
     */
    Renderer.prototype.draw = function draw(page) {
        var numPages = Parser.getNumPages(this.musicjson);
        if (numPages !== this.numPages) {
            if (numPages > this.numPages)
                this.addPage();
            else // remove last child
                this.$container.find('.concerto-page:last-child').remove();
            this.numPages = numPages;
        }

        var pages;
        if (page === undefined)
            pages = this.pages;
        else {
            for (var i = 0; i < pages.length; i++) {
                if (page === i)
                    pages.push(pages[i]);
                else
                    pages.push(undefined);
            }
        }

        Parser.parseAndDraw(pages, this.musicjson);
    };

    Renderer.prototype.clear = function clear(page) {
        var all = false;
        if (page === undefined)
            all = true;

        for (var i = 0; i < this.doms.length; i++) {
            if (!all && page !== i)
                continue;

            var $dom = this.doms[i];
            var $svg = $dom.find('svg');
            $svg.empty();
            $svg.attr('width', this.pageSize.width)
                .attr('height', this.pageSize.height);
        }
    };

    Renderer.prototype.update = function update(page) {
        // redraw only specific page
        this.clear(page);
        this.draw(page);
    };

    module.exports = Renderer;
});

// Concerto Base Libraries.
// Taehoon Moon <panarch@kaist.ac.kr>
//
// Concerto
//
// Copyright Taehoon Moon 2014

define('Concerto',['require','exports','module','Table','Converter','AttributesManager','MeasureManager','LayoutManager','NoteManager','BarlineManager','Parser','Renderer'],function(require, exports, module) {
    var Table = require('Table');
    var Converter = require('Converter');
    var AttributesManager = require('AttributesManager');
    var MeasureManager = require('MeasureManager');
    var LayoutManager = require('LayoutManager');
    var NoteManager = require('NoteManager');
    var BarlineManager = require('BarlineManager');
    var Parser = require('Parser');
    var Renderer = require('Renderer');

    function Concerto() {}

    Concerto.Table = Table;
    Concerto.Converter = Converter;
    Concerto.AttributesManager = AttributesManager;
    Concerto.MeasureManager = MeasureManager;
    Concerto.LayoutManager = LayoutManager;
    Concerto.NoteManager = NoteManager;
    Concerto.BarlineManager = BarlineManager;
    Concerto.Parser = Parser;
    Concerto.Renderer = Renderer;

    window.Concerto = Concerto;
    module.exports = Concerto;
});


require(["Concerto"]);
}());