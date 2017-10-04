import * as d3 from "d3";
import * as cola from "webcola";
const levelgraph = require("levelgraph");
const level = require("level-browserify");

import {updateColaLayout} from "./updateColaLayout";
import createColorArrow from "./util/createColorArrow";
import * as I from "./interfaces";


export default function networkVizJS(documentId: string, userLayoutOptions?: I.LayoutOptions) {
    /**
     * Default options for webcola and graph
     */
    const defaultLayoutOptions: I.LayoutOptions = {
        databaseName: `Userdb-${Math.random() * 100}-${Math.random() * 100}-${Math.random() * 100}-${Math.random() * 100}`,
        layoutType: "flowLayout", // Define webcola length layout algorithm
        jaccardModifier: 0.7,
        avoidOverlaps: true,
        handleDisconnected: false,
        flowDirection: "y",
        enableEdgeRouting: true,
        nodeShape: "rect",
        width: 900,
        height: 600,
        pad: 5,
        margin: 10,
        canDrag: () => true,
        nodeDragStart: undefined,
        edgeLabelText: undefined,
        // Both mouseout and mouseover take data AND the selection (arg1, arg2)
        mouseDownNode: undefined,
        mouseOverNode: undefined,
        mouseOutNode: undefined,
        mouseUpNode: undefined,
        // These are "live options"
        nodeToColor: "white",
        nodeStrokeWidth: 2,
        nodeStrokeColor: "black",
        // TODO: clickNode (node, element) => void
        clickNode: (node) => console.log("clicked", node),
        clickAway: () => undefined,
        edgeColor: "black",
        edgeStroke: 2,
        edgeLength: d => {console.log(`length`, d); return 150; },
        clickEdge: (d, element) => undefined,
    };

    const internalOptions = {
        isDragging: false
    };

    /**
     * Create the layoutOptions object with the users options
     * overriding the default options.
     */
    const layoutOptions: I.LayoutOptions = {
        ...defaultLayoutOptions,
        ...userLayoutOptions
    };

    /**
     * Check that the user has provided a valid documentId
     * and check that the id exists.
     */
    if (typeof documentId !== "string" || documentId === "") {
        throw new Error("Document Id passed into graph isn't a valid string.");
    }
    if (document.getElementById(documentId) === undefined) {
        throw new Error(`Can't find id '#${documentId}' on the page.`);
    }

    /**
     * In memory stores of the nodes and predicates.
     */
    const nodeMap: Map<string, any> = new Map();
    const predicateTypeToColorMap: Map<string, any> = new Map();
    const predicateMap: Map<string, any> = new Map();

    /**
     * Todo:    This is currently a hack. Create a random database on the client
     *          side to build the networks on top of.
     *          It's often better to just re-initialize a new db.
     */
    if (!layoutOptions.databaseName || typeof layoutOptions.databaseName !== "string") {
        console.error("Make sure databaseName property exists and is a string.");
        console.error("Choosing a default name for the database.");
        layoutOptions.databaseName = defaultLayoutOptions.databaseName;
    }
    const tripletsDB = levelgraph(level(layoutOptions.databaseName));

    /**
     * These represent the data that d3 will visualize.
     */
    const nodes: any[] = [];
    let links: any[] = [];
    let groups: any[] = [];
    const groupByHashes: any[] = [];

    const width = layoutOptions.width,
        height = layoutOptions.height,
        margin = layoutOptions.margin,
        pad = layoutOptions.pad;

    /**
     * Create svg canvas that is responsive to the page.
     * This will try to fill the div that it's placed in.
     */
    const svg = d3.select(`#${documentId}`)
        .append("div")
        .classed("svg-container", true)
        .append("svg")
        .attr("preserveAspectRatio", "xMinYMin meet")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .classed("svg-content-responsive", true);

    svg.on("click", layoutOptions.clickAway);

    /**
     * Set up [webcola](http://marvl.infotech.monash.edu/webcola/).
     * The helper function updateColaLayout allows for restarting
     * the simulation whenever the layout is changed.
     */
    let simulation = updateColaLayout(layoutOptions)
        .nodes(nodes)
        .links(links)
        .groups(groups)
        .start();

    /**
     * Call nodeDragStart callback when drag event triggers.
     */
    const drag = simulation.drag();
    drag.filter(() => (layoutOptions.canDrag === undefined) || (layoutOptions.canDrag()));
    drag.on("start", () => {
        layoutOptions.nodeDragStart && layoutOptions.nodeDragStart();
        internalOptions.isDragging = true;
    }).on("end", () => {
        internalOptions.isDragging = false;
    });

    /**
     * Create the defs element that stores the arrow heads.
     */
    const defs = svg.append("defs");

    // Define svg groups for storing the visuals.
    const g = svg.append("g");
    let group = g.append("g")
            .selectAll(".group"),
        link = g.append("g")
            .selectAll(".link"),
        node = g.append("g")
            .selectAll(".node");

    /**
     * Zooming and panning behaviour.
     */
    const zoom = d3.zoom().scaleExtent([0.1, 5]).on("zoom", zoomed);
    zoom.filter(function(){
        // Prevent zoom when mouse over node.
        return d3.event.target.tagName.toLowerCase() === "svg";
    });
    //Ghazal Start
    svg.call(zoom).on("dblclick.zoom", null);
    //Ghazal End

    function zoomed() {
        layoutOptions.clickAway();
        g.attr("transform", d3.event.transform);
    }

    /**
     * Resets width or radius of nodes.
     * Allows dynamically changing node sizes based on text.
     */
    function updatePathDimensions() {
        node.select("path")
            .attr("transform", function(d: any) {
                // Scale appropriately using http://stackoverflow.com/a/9877871/6421793
                const currentWidth = (this as any).getBBox().width,
                    w = d.width,
                    currentHeight = (this as any).getBBox().height,
                    h = d.height,
                    scaleW = w / currentWidth,
                    scaleH = h / currentHeight;
                if (isNaN(scaleW) || isNaN(scaleH) || isNaN(w) || isNaN(h)) {
                    return "";
                }
                return `translate(${-w / 2},${-h / 2}) scale(${scaleW},${scaleH})`;
            });
    }

    /**
     * This function re-centers the text.
     * This allows you to not change the text without restarting
     * jittering the text.
     * Must be run after updateStyles() to reposition on updated text.
     * @param textNodes - d3 selection of the text
     */
    function repositionText() {
        return Promise.resolve()
            .then(_ => {
                node.select("text").each(function(d) {
                    const text = d3.select(this);
                    const margin = layoutOptions.margin,
                        pad    = layoutOptions.pad;
                    const extra = 2 * margin + 2 * pad;
                    // The width must reset to allow the box to get smaller.
                    // Later we will set width based on the widest tspan/line.
                    d.width = d.minWidth || 0;
                    if (!(d.width)) {
                        d.width = d.minWidth || 0;
                    }
                    // Loop over the tspans and recalculate the width based on the longest text.
                    text.selectAll("tspan").each(function(d: any) {
                        const lineLength = (this as any).getComputedTextLength();
                        if (d.width < lineLength + extra) {
                            d.width = lineLength + extra;
                        }
                    });
                }).each(function(d: any){
                    // Only update the height, the width is calculated
                    // by iterating over the tspans in the `wrap` function.
                    const b = (this as any).getBBox();
                    const extra = 2 * margin + 2 * pad;
                    d.height = b.height + extra;
                })
                    .attr("y",  function(d){
                        const b = (d3.select(this).node() as any).getBBox();
                        // Todo: Minus 2 is a hack to get the text feeling 'right'.
                        return (d as any).height / 2 - b.height / 2 - 2;
                    })
                    .attr("x", function(d){
                        // Apply the correct x value to the tspan.
                        const b = (this as any).getBBox();
                        const x = (d as any).width / 2 - b.width / 2;
                        (d as any).textPosition = x;
                        // We don't set the tspans with an x attribute.
                        d3.select(this).selectAll("tspan")
                            .attr("x", (d as any).textPosition);
                        return (d as any).textPosition;
                    });
            });
    }

    /**
     * Update the d3 visuals without layout changes.
     */
    function updateStyles() {
        return new Promise((resolve, reject) => {
            ///// GROUPS /////
            group = group.data(groups);

            const groupEnter = group.enter()
                .append("rect")
                .attr("rx", 8)
                .attr("ry", 8)
                .attr("class", "group")
                .style("fill", "green");
            // .call(simulation.drag);
            group = group.merge(groupEnter);

            /////// NODE ///////

            node = node.data(nodes, d => d.index);
            node.exit().remove();
            const nodeEnter = node.enter()
                .append("g")
                .classed("node", true);

            // Only allow dragging nodes if turned on.
            // if (layoutOptions.canDrag()) {
            nodeEnter.attr("cursor", "move").call(drag); // Drag controlled by filter.
            // } else {
            //     nodeEnter.attr("cursor", "default");
            // }


            // Here we add node beauty.
            // To fit nodes to the short-name calculate BBox
            // from https://bl.ocks.org/mbostock/1160929
            nodeEnter.append("text")
                .attr("dx", 0)
                .attr("dy", 0)
                .attr("text-anchor", "left")
                .style("font", "100 22px Helvetica Neue");


            // Choose the node shape and style.
            let nodeShape;
            nodeShape = nodeEnter.insert("path", "text");

            if (typeof layoutOptions.nodeShape == "string" && layoutOptions.nodeShape == "rect") {
                // nodeShape = nodeEnter.insert("rect", "text")     // The second arg is what the rect will sit behind.
                nodeShape.attr("d", "M16 48 L48 48 L48 16 L16 16 Z");
            } else if (typeof layoutOptions.nodeShape == "string" && layoutOptions.nodeShape == "circle") {
                // Circle path technique from:
                // http://stackoverflow.com/a/10477334/6421793
                nodeShape.attr("d", "M20,40a20,20 0 1,0 40,0a20,20 0 1,0 -40,0");
            } else if (typeof layoutOptions.nodeShape == "function") {
                nodeShape.attr("d", layoutOptions.nodeShape);
            }
            nodeShape.attr("vector-effect", "non-scaling-stroke");

            // Merge the entered nodes to the update nodes.
            node = node.merge(nodeEnter)
                .classed("fixed", d => (d as any).fixed || false);

            /**
             * Update the text property (allowing dynamically changing text)
             * Check if the d.shortname is a list.
             */
            const textSelect = node.select("text")
                .text(undefined)
                .attr("class", d => (d as any).class)
                .each(function(d){
                    // This function takes the text element.
                    // We can call .each on it and build up
                    // the tspan elements from the array of text
                    // in the data.
                    // Derived from https://bl.ocks.org/mbostock/7555321
                    const margin = layoutOptions.margin,
                        pad    = layoutOptions.pad;
                    const extra = 2 * margin + 2 * pad;
                    const text = d3.select(this);

                    /**
                     * If no shortname, then use hash.
                     */
                    let tempText = (d as any).shortname || (d as any).hash;
                    if (!Array.isArray(tempText)) {
                        tempText = [tempText];
                    }

                    const textCopy = tempText.slice(),
                        words = textCopy.reverse(),
                        lineheight = 1.1, // em
                        lineNumber = 0,
                        dy = parseFloat(text.attr("dy")) || 0;
                    let word,
                        // TODO: I don't know why there needs to be a undefined tspan at the start?
                        tspan = text.text(undefined).append("tspan").attr("dy", dy + "em");
                    while (word = words.pop()) {
                        tspan = text.append("tspan")
                            .attr("dy", lineheight + "em")
                            .attr("x", (d as any).textPosition || ((d as any).width / 2) || 0)
                            .text(word);
                    }
                })
                // .attr("x", (d: any) => d.width / 2)
                // .attr("y", (d: any) => d.height / 2)
                .attr("pointer-events", "none");

            /**
             * Here we can update node properties that have already been attached.
             * When restart() is called, these are the properties that will be affected
             * by mutation.
             */
            const updateShapes = node.select("path")
                .attr("class", d => (d as any).class);
            // These changes apply to both rect and circle
            updateShapes
                .attr("fill", layoutOptions.nodeToColor as any)
                .attr("stroke", layoutOptions.nodeStrokeColor as any)
                .attr("stroke-width", layoutOptions.nodeStrokeWidth as any);

            // update size
            updatePathDimensions();


            // These CANNOT be arrow functions or 'this' context becomes wrong.
            updateShapes.on("mouseover", function(d){
                if (internalOptions.isDragging) { return; }

                var foWidth = 2;
                var foHeight = 1;
                var foX = d.width;
                var foY = 0;
                var element = d3.select(this); // The node
                var parent = d3.select(this.parentNode);
                node.selectAll('.radial-menu').remove();

                var fo = parent.append('foreignObject')
                    .attr('x', foX)
                    .attr('y', foY)
                    .attr('width', foWidth)
                    .attr('height', foHeight)
                    .attr('class', 'radial-menu');

                var div = fo.append('xhtml:div')
                    .append('div')
                    .attr('class', 'tools');
                div.append('div')
                    .html('<i class="fa fa-trash-o"></i>')
                    .on("click", function () {
                        console.log("clicked");
                        layoutOptions.nodeRemove && layoutOptions.nodeRemove(d);
                    })
                    .on("mouseout", function () {
                        console.log("mouseout");
                    })

                div.append('div')
                    .html('<i class="fa fa-thumb-tack"></i>')
                    .on("click", function () {
                        if (!d.fixed) {
                            d.fixed = true; // eslint-disable-line no-param-reassign
                            var foOnNode = parent.append('foreignObject')
                                .attr('x', d.width / 2)
                                .attr('y', 0)
                                .attr('class', 'node-status-icons');

                            var div = foOnNode.append('xhtml:div');
                            div.append('div')
                                .html('<i class="fa fa-thumb-tack"></i>')
                        } else {
                            d.fixed = false; // eslint-disable-line no-param-reassign
                            parent.selectAll('.node-status-icons').remove();
                        }
                        restart();
                        parent.selectAll('.radial-menu').remove();

                        // layoutOptions.pinNode && layoutOptions.pinNode(d);
                    });
                layoutOptions.mouseOverNode && layoutOptions.mouseOverNode(d, element);

            }).on("mouseout", function(d) {
                if (internalOptions.isDragging) { return; }

                var element = d3.select(this);
                var parent = d3.select(this.parentNode)
                var e = d3.event;
                var mouse = d3.mouse(this.parentElement);
                var mosX = mouse[0]
                var mosY = mouse[1]
                if (mosX < -1 || mosX > (d.width + 40) || mosY < -1 || mosY > d.height - 2 ||
                    (mosX < d.width && mosX > d.width / 2 && mosY > 0 && mosY < d.height) ||
                    (mosX < d.width / 2 && mosX > 0  && mosY > 0 && mosY < d.height))
                {
                    parent.selectAll('.node-context-menu').remove();
                }

                layoutOptions.mouseOutNode && layoutOptions.mouseOutNode(d, element as any);
            }).on("click", function(d) {
                let elem = d3.select(this);
                setTimeout(() => {
                    layoutOptions.clickNode(d, elem as any);
                }, 50);

            }).on("mouseup", function (d){
                layoutOptions.mouseUpNode && layoutOptions.mouseUpNode(d, d3.select(this) as any);
            }).on("mousedown", function(d){

                if ((layoutOptions.canDrag === undefined) || (layoutOptions.canDrag())) { return; }
                layoutOptions.mouseDownNode && layoutOptions.mouseDownNode(d, d3.select(this) as any);
            });

            /////// LINK ///////
            link = link.data(links, d => d.source.index + "-" + d.target.index);
            link.exit().remove();

            const linkEnter = link.enter()
                .append("g")
                .classed("line", true);


            linkEnter.append("path")
                .attr("stroke-width", layoutOptions.edgeStroke as any)
                // Todo: Have edge data changable from outside the library.
                .attr("stroke", layoutOptions.edgeColor as any)
                .attr("fill", "none")
                .attr("marker-end", d => `url(#arrow-${typeof layoutOptions.edgeColor == "string" ? layoutOptions.edgeColor : (layoutOptions.edgeColor as any)((d as any).edgeData)})`);

            linkEnter.on("click", function(d) {
                const elem = d3.select(this);
                setTimeout(() => {
                    layoutOptions.clickEdge(d, elem as any);
                }, 50);
            });

            // Add an empty text field.
            linkEnter.append("text")
                .attr("text-anchor", "middle")
                .style("font", "100 22px Helvetica Neue")
                .text(undefined);

            link = link.merge(linkEnter);

            /** Optional label text */
            if (typeof layoutOptions.edgeLabelText === "function") {
                link.select("text").text((d) => {
                    if (typeof (d as any).edgeData.hash === "string") {
                        return (layoutOptions.edgeLabelText as any)(predicateMap.get((d as any).edgeData.hash));
                    }
                    return (layoutOptions.edgeLabelText as any)((d as any).edgeData);
                });
            }

            return resolve();
        });
    }

    /**
     * restart function adds and removes nodes.
     * It also restarts the simulation.
     * This is where aesthetics can be changed.
     */
    function restart(callback?: () => void) {
        // Todo: Promise chain.
        return Promise.resolve()
            .then(updateStyles)
            .then(repositionText)
            .then(_ => {
                /**
                 * Helper function for drawing the lines.
                 */
                const lineFunction = d3.line()
                    .x(d => (d as any).x)
                    .y(d => (d as any).y);

                /**
                 * Causes the links to bend around the rectangles.
                 * Source: https://github.com/tgdwyer/WebCola/blob/master/WebCola/examples/unix.html#L140
                 */
                const routeEdges = function () {
                    if (links.length == 0 || !layoutOptions.enableEdgeRouting) {
                        return;
                    }
                    try {
                        simulation.prepareEdgeRouting();
                    } catch (err) {
                        console.error(err);
                        return;
                    }

                    try {
                        link.select("path").attr("d", d => lineFunction(simulation.routeEdge(d, undefined)));
                    } catch (err) {
                        console.error(err);
                        return;
                    }

                    try {
                        if (isIE()) link.select("path").each(function (d) { (this as any).parentNode.insertBefore(this, this); });
                    } catch (err) {
                        console.log(err);
                        return;
                    }
                    link.select("text").attr("x", d => {
                        const arrayX = simulation.routeEdge(d, undefined);
                        const middleIndex = Math.floor(arrayX.length / 2) - 1;
                        return (arrayX[middleIndex].x + arrayX[middleIndex + 1].x) / 2;
                    }).attr("y", d => {
                        const arrayY = simulation.routeEdge(d, undefined);
                        const middleIndex = Math.floor(arrayY.length / 2) - 1 ;
                        return (arrayY[middleIndex].y + arrayY[middleIndex + 1].y) / 2;
                    });
                };

                // Restart the simulation.
                simulation.links(links)    // Required because we create new link lists
                    .groups(groups)
                    .start(10, 15, 20).on("tick", function() {
                    node.each((d: any) => {
                        if (d.bounds) {
                            // Initiate the innerBounds, and create it based on the width and height
                            // of the node.
                            d.innerBounds = (d as any).bounds.inflate(0);
                            d.innerBounds.X = d.innerBounds.x + d.width;
                            d.innerBounds.Y = d.innerBounds.y + d.height;
                        }
                    });
                    node.attr("transform", d => (d as any).innerBounds ?
                        `translate(${(d as any).innerBounds.x},${(d as any).innerBounds.y})`
                        : `translate(${(d as any).x},${(d as any).y})`);

                    updatePathDimensions();

                    link.select("path").attr("d", d => {
                        let route;
                        try {
                            route = cola.makeEdgeBetween((d as any).source.innerBounds, (d as any).target.innerBounds, 5);
                        } catch (err) {
                            console.error(err);
                            return;
                        }
                        return lineFunction([route.sourceIntersection, route.arrowStart] as any);
                    });
                    if (isIE()) link.each(function (d) { (this as any).parentNode.insertBefore(this, this); });

                    link.select("text")
                        .attr("x", d => {
                            let route;
                            try {
                                route = cola.makeEdgeBetween((d as any).source.innerBounds, (d as any).target.innerBounds, 5);
                            } catch (err) {
                                console.error(err);
                                return 0;
                            }
                            return (route.sourceIntersection.x + route.targetIntersection.x) / 2;
                        })
                        .attr("y", d => {
                            let route;
                            try {
                                route = cola.makeEdgeBetween((d as any).source.innerBounds, (d as any).target.innerBounds, 5);
                            } catch (err) {
                                console.error(err);
                                return 0;
                            }
                            return (route.sourceIntersection.y + route.targetIntersection.y) / 2;
                        });

                    group.attr("x", function(d){ return (d as any).bounds.x; })
                        .attr("y", function(d){ return (d as any).bounds.y; })
                        .attr("width", function(d){ return (d as any).bounds.width(); })
                        .attr("height", function(d){ return (d as any).bounds.height(); });

                }).on("end", routeEdges);
                function isIE() { return ((navigator.appName == "Microsoft Internet Explorer") || ((navigator.appName == "Netscape") && (new RegExp("Trident/.*rv:([0-9]{1,}[\.0-9]{0,})").exec(navigator.userAgent) != undefined))); }

                // After a tick make sure to add translation to the nodes.
                // Sometimes it wasn"t added in a single tick.
                node.attr("transform", d => (d as any).innerBounds ?
                    `translate(${(d as any).innerBounds.x},${(d as any).innerBounds.y})`
                    : `translate(${(d as any).x},${(d as any).y})`);
            })
            .then(() => typeof callback === "function" && callback());
    }


    // Helper function for updating links after node mutations.
    // Calls a function after links added.
    function createNewLinks(callback?: () => void) {
        tripletsDB.get({}, (err: Error, l: any[]) => {
            if (err) {
                console.error(err);
            }
            // Create edges based on LevelGraph triplets
            links = l.map(({subject, object, edgeData}) => {
                const source = nodeMap.get(subject);
                const target = nodeMap.get(object);
                return { source, target, edgeData };
            });
            restart(callback);
        });
    }

    /**
     * Take a node object or list of nodes and add them.
     * @param {object | object[]} nodeObject
     */
    function addNode(nodeObjectOrArray: any | any[], callback?: () => void, preventLayout?: Boolean) {
        /** Define helper functions at the top */
        /**
         * Checks if object is an array:
         * http://stackoverflow.com/a/34116242/6421793
         * @param {object|array} obj
         */
        function isArray(obj: any) {
            return !!obj && obj.constructor === Array;
        }
        function addNodeObjectHelper(nodeObject: any) {
            // Check that hash exists
            if (!(nodeObject.hash)) {
                throw new Error("Node requires a hash field.");
            }

            // TODO: remove this hack
            if (!(nodeObject.x)) {
                nodeObject.x = layoutOptions.width / 2;
            }
            if (!(nodeObject.y)) {
                nodeObject.y = layoutOptions.height / 2;
            }


            // Add node to graph
            if (!nodeMap.has(nodeObject.hash)) {
                simulation.stop();
                // Set the node
                nodes.push(nodeObject);
                nodeMap.set(nodeObject.hash, nodeObject);
            }
        }

        /**
         * Check that the input is valid
         */
        if (typeof nodeObjectOrArray !== "object") {
            throw new Error("Parameter must be either an object or an array");
        }
        if (isArray(nodeObjectOrArray)) {
            // Run through the array adding the nodes
            nodeObjectOrArray.forEach(addNodeObjectHelper);
        } else {
            addNodeObjectHelper(nodeObjectOrArray);
        }

        // Draw the changes, and either fire callback or pass it on to restart.
        if (!preventLayout) {
            restart(callback);
        } else {
            typeof callback === "function" && callback();
        }
    }

    /**
     * Validates triplets.
     * @param {object} tripletObject
     */
    function tripletValidation(tripletObject: I.Triplet) {
        /**
         * Check that minimum requirements are met.
         */
        if (tripletObject === undefined) {
            throw new Error("TripletObject undefined");
        }

        // Node needs a unique hash associated with it.
        const subject = tripletObject.subject,
            predicate = tripletObject.predicate,
            object = tripletObject.object;

        if (!(subject && predicate && object && true)) {
            throw new Error("Triplets added need to include all three fields.");
        }

        // Check that hash exists
        if (!(subject.hash && object.hash)) {
            throw new Error("Subject and Object require a hash field.");
        }

        // Check that type field exists on predicate
        if (!predicate.type) {
            throw new Error("Predicate requires type field.");
        }

        // Check that type field is a string on predicate
        if (typeof predicate.type !== "string") {
            throw new Error("Predicate type field must be a string");
        }
        return true;
    }

    /**
     * Adds a triplet object. Adds the node if it's not already added.
     * Otherwise it just adds the edge
     * @param {object} tripletObject
     */
    function addTriplet(tripletObject: I.Triplet, callback?: () => void, preventLayout?: Boolean) {
        if (!tripletValidation(tripletObject)) {
            return;
        }
        // Node needs a unique hash associated with it.
        const subject = tripletObject.subject,
            predicate = tripletObject.predicate,
            object = tripletObject.object;

        // Check that predicate doesn't already exist
        new Promise((resolve, reject) => tripletsDB.get({subject: subject.hash,
            predicate: predicate.type,
            object: object.hash}, function(err: Error, list: any[]){
            if (err) reject(err);
            resolve(list.length === 0);
        })).then(doesntExist => {
            if (!doesntExist) {
                console.warn("That edge already exists. Hash's and predicate type needs to be unique!");
                return;
            }
            /**
             * If a predicate type already has a color,
             * it is not redefined.
             */
            const edgeColor = typeof layoutOptions.edgeColor == "string" ? layoutOptions.edgeColor : (layoutOptions.edgeColor as any)(predicate);
            if (!predicateTypeToColorMap.has(edgeColor)) {
                predicateTypeToColorMap.set(edgeColor, true);

                // Create an arrow head for the new color
                createColorArrow(defs, edgeColor);
            }

            /**
             * If the predicate has a hash, it is added to a Map.
             * This way we can mutate the predicate to manipulate its
             * properties.
             * Basically we are saving a reference to the predicate object.
             */
            if (predicate.hash) {
                if (predicateMap.has(predicate.hash)) {
                    console.warn("Edge hash must be unique. There already exists a predicate with the hash: ", predicate.hash);
                }
                predicateMap.set(predicate.hash, predicate);
            }


            /**
             * Put the triplet into the LevelGraph database
             * and mutates the d3 nodes and links list to
             * visually pop on the node/s.
             */
            tripletsDB.put({
                subject: subject.hash,
                predicate: predicate.type,
                object: object.hash,
                edgeData: predicate
            }, (err: Error) => {
                if (err) {
                    console.error(err);
                }

                // Add nodes to graph
                simulation.stop();
                if (!nodeMap.has(subject.hash)) {
                    // Set the node
                    nodes.push(subject);
                    nodeMap.set(subject.hash, subject);
                }
                if (!nodeMap.has(object.hash)) {
                    nodes.push(object);
                    nodeMap.set(object.hash, object);
                }
                if (!preventLayout) {
                    createNewLinks(callback);
                }
            });
        });
    }

    /**
     * Removes a triplet object. Silently fails if edge doesn't exist.
     * @param {object} tripletObject
     */
    function removeTriplet(tripletObject: I.Triplet, callback?: () => void) {
        if (!tripletValidation(tripletObject)) {
            return;
        }
        // Node needs a unique hash associated with it.
        const subject = tripletObject.subject,
            predicate = tripletObject.predicate,
            object = tripletObject.object;

        // Check that predicate doesn't already exist
        new Promise((resolve, reject) => tripletsDB.del({subject: subject.hash,
            predicate: predicate.type,
            object: object.hash}, function(err: Error){
            if (err) reject(err);
            resolve();
        })).then(() => {
            // Add nodes to graph
            simulation.stop();

            createNewLinks(callback);
        });
    }

    /**
     * Removes the node and all triplets associated with it.
     * @param {String} nodeHash hash of the node to remove.
     */
    function removeNode(nodeHash: string, callback?: () => void) {
        tripletsDB.get({subject: nodeHash}, function(err: Error, l1: any[]){
            if (err) {
                return console.error(err);
            }
            tripletsDB.get({object: nodeHash}, function(err: Error, l2: any[]){
                if (err) {
                    return console.error(err);
                }
                // Check if the node exists
                if (l1.length + l2.length === 0) {
                    // Once the edges are deleted we can remove the node.
                    let nodeIndex = -1;
                    for (let i = 0; i < nodes.length; i++) {
                        if (nodes[i].hash === nodeHash) {
                            nodeIndex = i;
                            break;
                        }
                    }
                    if (nodeIndex === -1) {
                        return console.error("There is no node");
                    }
                    simulation.stop();
                    nodes.splice(nodeIndex, 1);
                    nodeMap.delete(nodeHash);

                    createNewLinks(callback);
                    return;
                }

                tripletsDB.del([...l1, ...l2], function(err: Error){
                    if (err) { return err; }

                    // Once the edges are deleted we can remove the node.
                    let nodeIndex = -1;
                    for (let i = 0; i < nodes.length; i++) {
                        if (nodes[i].hash === nodeHash) {
                            nodeIndex = i;
                            break;
                        }
                    }
                    if (nodeIndex === -1) {
                        return console.error("There is no node");
                    }
                    simulation.stop();
                    nodes.splice(nodeIndex, 1);
                    nodeMap.delete(nodeHash);

                    createNewLinks(callback);
                });
            });
        });
    }


    /**
     * Function that fires when a node is clicked.
     * @param {function} selectNodeFunc
     */
    function setSelectNode(selectNodeFunc: (nodeObject?: any, d3Selection?: any) => void) {
        layoutOptions.clickNode = selectNodeFunc;
    }

    /**
     * Invoking this function will recenter the graph.
     */
    // function recenterGraph(){
    //     svg.transition().duration(300).call(zoom.transform, d3.zoomIdentity.translate(0, 0).scale(1))
    // }


    /**
     * Function to call when mouse over registers on a node.
     * It takes a d3 mouse over event.
     * @param {function} mouseOverCallback
     */
    function setMouseOver(mouseOverCallback: any) {
        layoutOptions.mouseOverNode = mouseOverCallback;
    }

    /**
     * Function to call when mouse out registers on a node.
     * It takes a d3 mouse over event.
     * @param {function} mouseOutCallback
     */
    function setMouseOut(mouseOutCallback: any) {
        layoutOptions.mouseOutNode = mouseOutCallback;
    }

    // Function called when mousedown on node.
    function setMouseDown(mouseDownCallback: any) {
        layoutOptions.mouseDownNode = mouseDownCallback;
    }

    /**
     * Merges a node into another group.
     * If this node was in another group previously it removes it from the prior group.
     */
    function mergeNodeToGroup(nodeInGroupHash: string, nodeToMergeHash: string, callback: () => void) {
        console.error("THIS FEATURE IS NOT READY");
        console.error("USE AT YOUR OWN RISK!");
        /**
         * Groups need to be defined using indexes.
         */
        let indexOfGroupNode = -1;
        let indexOfNodeToMerge = -1;
        for (let i = 0; i < nodes.length; i++) {
            if (nodes[i].hash == nodeInGroupHash) {
                indexOfGroupNode = i;
            }
            if (nodes[i].hash == nodeToMergeHash) {
                indexOfNodeToMerge = i;
            }
            if (indexOfGroupNode !== -1 && indexOfNodeToMerge !== -1) {
                break;
            }
        }
        // Verify that the initial node exists.
        if (indexOfGroupNode == -1) {
            return console.error("You're trying to merge with a node that doesn't exist. Check that the node hash is correct.");
        }
        if (indexOfNodeToMerge == -1) {
            return console.error("The node you are trying to merge doesn't exist. Check the node hash is correct or add the node to the graph.");
        }

        // Find the set that the merge node is part of.
        // Also remove the node we're merging from any sets it might be in.
        let indexInSets = -1;
        groupByHashes.forEach((set, index) => {
            if (set.has(nodeInGroupHash)) {
                indexInSets = index;
                set.add(nodeToMergeHash);
            }
            if (set.has(nodeToMergeHash) && !set.has(nodeInGroupHash)) {
                set.delete(nodeToMergeHash);
            }
        });

        if (indexInSets === -1) {
            // Create a new grouping.
            groupByHashes.push(new Set([nodeToMergeHash, nodeInGroupHash]));
        }

        simulation.stop();
        // Here we create a new group object with the updated group unions.
        const newGroupObject: any[] = [];
        groupByHashes.forEach(set => {
            const indexOfSet = [];
            const setArray = [...set];
            let nodeIndex;
            for (let i = 0; i < setArray.length; i ++) {
                nodeIndex = nodeMap.get(setArray[i]).index;
                indexOfSet.push(nodeIndex);
            }
            // Create and push an object with the indexes of the nodes.
            newGroupObject.push({leaves: indexOfSet});
        });
        groups = newGroupObject;

        restart(callback);
    }


    /**
     * Serialize the graph.
     * scheme: triplets: subj:hash-predicateType-obj:hash[]
     *         nodes: hash[]
     */
    const saveGraph = (callback: (_: string) => any) => {
        tripletsDB.get({}, (err: Error, l: any[]) => {
            const saved = JSON.stringify({
                triplets: l.map(v => ({ subject: v.subject, predicate: v.predicate, object: v.object })),
                nodes: nodes.map(v => ({ hash: v.hash, x: v.x, y: v.y }))
            });
            callback(saved);
        });
    };

    /**
     * These exist to prevent errors when the user
     * tabs away from the graph.
     */
    window.onfocus = function() {
        restart();
    };
    window.onblur = function() {
        simulation.stop();
    };

    // Public api
    /**
     * TODO:
     * Allow reference to the graph in the options object.
     * Solutions?:
     *  - Maybe have a "this" reference passed into the callbacks.
     */

    return {
        // Check if node is drawn.
        hasNode: (nodeHash: string) => nodes.filter(v => v.hash == nodeHash).length === 1,
        // Public access to the levelgraph db.
        getDB: () => tripletsDB,
        // Get Stringified representation of the graph.
        saveGraph,
        // Get SVG element. If you want the node use `graph.getSVGElement().node();`
        getSVGElement: () => svg,
        // add a directed edge
        addTriplet,
        // remove an edge
        removeTriplet,
        // EXPERIMENTAL - DONT USE YET.
        mergeNodeToGroup,
        // remove a node and all edges connected to it.
        removeNode,
        // add a node or array of nodes.
        addNode,
        // Restart styles or layout.
        restart: {
            styles: updateStyles,
            textAlign: repositionText,
            redrawEdges: createNewLinks,
            layout: restart,
        },
        canvasOptions: {
            setWidth: (width: number) => {
                svg.attr("viewBox", `0 0 ${width} ${layoutOptions.height}`);
                layoutOptions.width = width;
            },
            setHeight: (height: number) => {
                svg.attr("viewBox", `0 0 ${layoutOptions.width} ${height}`);
                layoutOptions.height = height;
            },
        },
        // Set event handlers for node.
        nodeOptions: {
            setClickNode: setSelectNode,
            setMouseOver,
            setMouseOut,
            setMouseDown,
        },
        // Handler for clicking on the edge.
        edgeOptions: {
            setClickEdge: (callback: (link?: any, d3selection?: any) => void) => {layoutOptions.clickEdge = callback; }
        },
        // Change layouts on the fly.
        // May be a webcola memory leak if you change the layout too many times.
        colaOptions: {
            flowLayout: {
                down: (callback?: () => void) => {
                    layoutOptions.flowDirection = "y";
                    if (layoutOptions.layoutType == "flowLayout") {
                        simulation.flowLayout(layoutOptions.flowDirection, layoutOptions.edgeLength);
                    } else {
                        layoutOptions.layoutType = "flowLayout";
                        simulation = updateColaLayout(layoutOptions);
                    }
                    restart(callback);
                },
                right: (callback?: () => void) => {
                    layoutOptions.flowDirection = "x";
                    if (layoutOptions.layoutType == "flowLayout") {
                        simulation.flowLayout(layoutOptions.flowDirection, layoutOptions.edgeLength);
                    } else {
                        layoutOptions.layoutType = "flowLayout";
                        simulation = updateColaLayout(layoutOptions);
                    }
                    restart(callback);
                }
            }
        }
    };
}