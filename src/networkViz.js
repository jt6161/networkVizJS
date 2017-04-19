import * as cola from 'webcola';
import * as d3 from 'd3';
let levelgraph = require('levelgraph');
let level = require('level-browserify');

module.exports = function networkVizJS(documentId, userLayoutOptions = {}){

    /**
     * Default options for webcola
     */
    let defaultLayoutOptions = {
        layoutType: "flowLayout", // Define webcola length layout algorithm
        avoidOverlaps: true,
        handleDisconnected: false,
        flowDirection: "y",
        enableEdgeRouting: true,
        nodeShape: "rect"
    }

    /**
     * This creates the default object, and then overwrites any parameters
     * with the user parameters.
     */
    let layoutOptions = {
        ...defaultLayoutOptions,
        ...userLayoutOptions
    };


    if (typeof documentId !== "string" || documentId === "") {
        throw new Error("Document Id passed into graph isn't a string.");
    }

    /**
     *  Options
     * TODO: wrap validation on each of the settings
     */
    let options = {
        // Set this as a function that transforms the node -> color string
        nodeToColor: undefined,
        clickNode: (node) => console.log("clicked", node),
        clickAway: () => console.log("clicked away from stuff"),
        edgeColor: () => "black",
        edgeStroke: undefined,
        edgeLength: d => {console.log(`length`, d); return 150}
    }

    /**
     * nodeMap allows hash lookup of nodes.
     */
    let nodeMap = new Map();
    let predicateTypeToColorMap = new Map();
    let tripletsDB = levelgraph(level(`Userdb-${Math.random()*100}`));
    let nodes = [];
    let links = [];
    let mouseCoordinates = [0, 0]

    const width = 900,
          height = 600,
          margin = 10,
          pad = 12;
    
    // Here we are creating a responsive svg element.
    let svg = d3.select(`#${documentId}`)
                .append("div")
                .classed("svg-container", true)
                .append("svg")
                .attr("preserveAspectRatio", "xMinYMin meet")
                .attr("viewBox", `0 0 ${width} ${height}`)
                .classed("svg-content-responsive", true);
    
    /**
     * Keep track of the mouse.
     */
    svg.on("mousemove", function() {
        mouseCoordinates = d3.mouse(this)
    })
    svg.on("click", () => {
        options.clickAway();
    })

    /**
     * Set up [webcola](http://marvl.infotech.monash.edu/webcola/).
     * Later we'll be restarting the simulation whenever we mutate
     * the node or link lists.
     */
    let simulation = updateColaLayout();
    
    /**
     * Here we define the arrow heads to be used later.
     * Each unique arrow head needs to be created.
     */
    const defs = svg.append("defs");

    /**
     * Appends a new marker to the dom, for the new
     * marker color.
     * @param {defs DOMElement} definitionElement 
     * @param {string} color valid css color string
     */
    const createColorMarker = (definitionElement, color) => {
        definitionElement.append("marker")
            .attr("id",`arrow-${color}`)
            .attr("viewBox", "0 -5 10 10")
            .attr("refX", 8)
            .attr("markerWidth", 6)
            .attr("markerHeight", 6)
            .attr("fill", color)
            .attr("orient", "auto")
            .append("path")
                .attr("d", "M0,-5L10,0L0,5")
                .attr("class","arrowHead");
    }

    // Define svg groups
    let g = svg.append("g"),
        link = g.append("g")
                .selectAll(".link"),
        node = g.append("g")
                .selectAll(".node");
    
    /**
     * Add zoom/panning behaviour to svg.
     */
    let zoom = d3.zoom().scaleExtent([0.1, 5]).on("zoom", zoomed);
    svg.call(zoom);
    function zoomed() {
        options.clickAway();
        g.attr("transform", d3.event.transform);
    }
    


    /**
     * restart function adds and removes nodes.
     * It also restarts the simulation.
     * This is where aesthetics can be changed.
     */
    function restart(){
        /////// NODE ///////

        node = node.data(nodes, d => d.index);
        node.exit().remove();
        let nodeEnter = node.enter()
                   .append("g")
                   .each(d => {d.createMargin = false})
                   .classed("node", true)
                   .attr("cursor", "move")
                   .call(simulation.drag);
                   
        
        // Here we add node beauty.
        // To fit nodes to the short-name calculate BBox
        // from https://bl.ocks.org/mbostock/1160929
        let text = nodeEnter.append("text")
                    .attr("dx", -10)
                    .attr("dy", -2)
                    .attr("text-anchor", "middle")
                    .style("font", "100 22px Helvetica Neue")
                    .text(d => d.shortname || d.hash)
                    .each(function(d){
                        if (d.createMargin){
                            return
                        }
                        const b = this.getBBox();
                        const extra = 2 * margin + 2 * pad;
                        d.width = b.width + extra;
                        d.height = b.height + extra;
                        d.createMargin = !d.createMargin;
                    })
                    .attr("x", d => d.width / 2)
                    .attr("y", d => d.height / 2);
        // Choose the node shape and style.
        let nodeShape;
        if (layoutOptions.nodeShape == "rect"){
            nodeShape = nodeEnter.insert("rect", "text")     // The second arg is what the rect will sit behind.
        } else if (layoutOptions.nodeShape == "circle"){
            nodeShape = nodeEnter.insert("circle", "text")     // The second arg is what the rect will sit behind.
        }
        nodeShape.classed("node", true)
                .attr("fill", d => options.nodeToColor && options.nodeToColor(d) || "aqua");
        
        
        node = node.merge(nodeEnter)

        /**
         * Rebind the handlers on the nodes.
         */
        node.on('click', function(node) {
            // coordinates is a tuple: [x,y]
            setTimeout(() => {
                options.clickNode(node, mouseCoordinates)
            }, 50)
            
        })

        /////// LINK ///////
        link = link.data(links, d => d.source.index + "-" + d.target.index)
        link.exit().remove();

        link = link.enter()
                   .append("path")
                   .attr("class", "line")
                   .attr("stroke-width", d => options.edgeStroke && options.edgeStroke(d) || 2)
                   .attr("stroke", d => options.edgeColor(d.edgeData))
                   .attr("fill", "none")
                   .attr("marker-end",d => `url(#arrow-${options.edgeColor(d.edgeData)})`)
                   .merge(link);
        
        /**
         * Helper function for drawing the lines.
         */
        const lineFunction = d3.line()
            .x(d => d.x)
            .y(d => d.y);

        /**
         * Causes the links to bend around the rectangles.
         * Source: https://github.com/tgdwyer/WebCola/blob/master/WebCola/examples/unix.html#L140
         */
        const routeEdges = function () {
            if (links.length == 0 || !layoutOptions.enableEdgeRouting) {
                return
            }
            simulation.prepareEdgeRouting();
            link.attr("d", d => lineFunction(simulation.routeEdge(d)));
            if (isIE()) link.each(function (d) { this.parentNode.insertBefore(this, this) });
        }
        // Restart the simulation.
        simulation.links(links);    // Required because we create new link lists
        simulation.start(10, 15, 20).on("tick", function() {
            node.each(d => {
                    if (d.bounds) {
                        d.innerBounds = d.bounds.inflate(-margin);
                    }
                })
                .attr("transform", d => d.innerBounds ?
                    `translate(${d.innerBounds.x},${d.innerBounds.y})`
                    :`translate(${d.x},${d.y})`);
            node.select('rect')
                .attr("width", d => d.innerBounds && d.innerBounds.width() || d.width)
                .attr("height", d => d.innerBounds && d.innerBounds.height() || d.height);

            node.select('circle')
                .attr("r", d => (d.innerBounds && d.innerBounds.width() || d.width) / 2)
                .attr("cx", d => (d.innerBounds && d.innerBounds.width() || d.width) / 2)
                .attr("cy", d => (d.innerBounds && d.innerBounds.height() || d.height) / 2)

            link.attr("d", d => {
                let route = cola.makeEdgeBetween(d.source.innerBounds, d.target.innerBounds, 5);
                return lineFunction([route.sourceIntersection, route.arrowStart]);
            });
            if (isIE()) link.each(function (d) { this.parentNode.insertBefore(this, this) });

        }).on("end", routeEdges);
        function isIE() { return ((navigator.appName == 'Microsoft Internet Explorer') || ((navigator.appName == 'Netscape') && (new RegExp("Trident/.*rv:([0-9]{1,}[\.0-9]{0,})").exec(navigator.userAgent) != null))); }
    }

    // Helper function for updating links after node mutations.
    // Calls a function after links added.
    function createNewLinks(){
        tripletsDB.get({}, (err, l) => {
            if (err){
                throw new Error(err);
            }
            // Create edges based on LevelGraph triplets
            links = l.map(({subject, object, edgeData}) => {
                let source = nodeMap.get(subject);
                let target = nodeMap.get(object);
                return { source, target, edgeData }
            });   
            restart()
        })
    }

    function addNode(nodeObject){
        // Check that hash exists
        if (!(nodeObject.hash)) {
            var e = new Error("Node requires a hash field.");
            console.error(e);
            return
        }

        // Add node to graph
        if (!nodeMap.has(nodeObject.hash)){
            // Set the node
            nodes.push(nodeObject)
            nodeMap.set(nodeObject.hash, nodeObject);
        }
        restart();
    }

    /**
     * Validates triplets.
     * @param {object} tripletObject 
     */
    function tripletValidation(tripletObject){
        /**
         * Check that minimum requirements are met.
         */
        if (tripletObject === undefined) {
            var e = new Error("TripletObject undefined");
            console.error(e);
            return false
        }

        // Node needs a unique hash associated with it.
        let subject = tripletObject.subject,
            predicate = tripletObject.predicate,
            object = tripletObject.object;

        if (!(subject && predicate && object && true)){
            throw new Error("Triplets added need to include all three fields.")
            return false
        }

        // Check that hash exists
        if (!(subject.hash && object.hash)) {
            var e = new Error("Subject and Object require a hash field.");
            console.error(e);
            return false
        }

        // Check that type field exists on predicate
        if (!predicate.type) {
            var e = new Error("Predicate requires type field.");
            console.error(e);
            return false
        }

        // Check that type field is a string on predicate
        if (typeof predicate.type !== "string") {
            var e = new Error("Predicate type field must be a string");
            console.error(e);
            return false
        }
        return true
    }

    function addTriplet(tripletObject){
        if (!tripletValidation(tripletObject)){
            return
        }
        // Node needs a unique hash associated with it.
        let subject = tripletObject.subject,
            predicate = tripletObject.predicate,
            object = tripletObject.object;

        /**
         * If a predicate type already has a color,
         * it is not redefined.
         */
        if (!predicateTypeToColorMap.has(options.edgeColor(predicate))){
            predicateTypeToColorMap.set(options.edgeColor(predicate), true);

            // Create an arrow head for the new color
            createColorMarker(defs, options.edgeColor(predicate));
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
        }, err => {
            if (err){
                throw new Error(err);
            }
            
            // Add nodes to graph
            if (!nodeMap.has(subject.hash)){
                // Set the node
                nodes.push(subject)
                nodeMap.set(subject.hash, subject);
            }
            if (!nodeMap.has(object.hash)){
                nodes.push(object)
                nodeMap.set(object.hash, object);
            }

            createNewLinks();
        });
    }

    function addEdge(triplet){
        if (!tripletValidation(triplet)){
            return
        }
        // Node needs a unique hash associated with it.
        let subject = triplet.subject,
            predicate = triplet.predicate,
            object = triplet.object;
        
        if (!(nodeMap.has(subject.hash) && nodeMap.has(object.hash))){
            // console.error("Cannot add edge between nodes that don't exist.")
            return
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
        }, err => {
            if (err){
                throw new Error(err);
            }

            createNewLinks();
        });

    }

    /**
     * Removes the node and all triplets associated with it.
     * @param {String} nodeHash hash of the node to remove.
     */
    function removeNode(nodeHash){
        tripletsDB.get({subject: nodeHash}, function(err, l1){
            if (err){
                return console.error(err)
            }
            tripletsDB.get({object: nodeHash}, function(err, l2){
                if (err){
                    return console.error(err)
                }
                // Check if the node exists
                if (l1.length + l2.length === 0){
                    return console.error("There was nothing to remove")
                }

                [...l1, ...l2].forEach(triplet => tripletsDB.del(triplet, function(err){
                    if (err){
                        return console.error(err);
                    }
                }));


                // Remove the node
                let nodeIndex = -1;
                for (let i = 0; i < nodes.length; i++){
                    if (nodes[i].hash === nodeHash){
                        nodeIndex = i;
                        break;
                    }
                }
                if (nodeIndex === -1){
                    return console.error("There is no node");
                }

                nodeMap.delete(nodeHash);
                nodes.splice(nodeIndex, 1);

                createNewLinks();
            });
        });
    }

    function setNodeToColor(nodeToColorFunc){
        options.nodeToColor = nodeToColorFunc;
    }

    /**
     * Function that fires when a node is clicked.
     * @param {function} selectNodeFunc 
     */
    function setSelectNode(selectNodeFunc){
        options.clickNode = selectNodeFunc;
    }

    /**
     * Invoking this function will recenter the graph.
     */
    function recenterGraph(){
        svg.transition().duration(300).call(zoom.transform, d3.zoomIdentity.translate(0, 0).scale(1))
    }

    /**
     * Replaces function to call when clicking away from a node.
     * @param {function} clickAwayCallback 
     */
    function setClickAway(clickAwayCallback){
        options.clickAway = clickAwayCallback;
    }

    /**
     * Function called when choosing edge color based on predicate.
     * @param {function} edgeColorCallback takes string 'predicate.type' to a color.
     */
    function setEdgeColor(edgeColorCallback){
        options.edgeColor = edgeColorCallback;
    }

    /**
     * Function called when choosing a stroke width.
     * Takes the edge object {source, edgeData, target} and returns a number
     * @param {function} edgeStrokeCallback 
     */
    function setEdgeStroke(edgeStrokeCallback){
        options.edgeStroke = edgeStrokeCallback;
    }

    /**
     * Function for setting the ideal edge lengths.
     * This takes an edge object and should return a number.
     * Edge object has the following shape: {source, edgeData, target}.
     * This will become the min length.
     */
    function setEdgeLength(edgeLengthCallback){
        options.edgeLength = edgeLengthCallback;
        restart();
    }

    /**
     * Function for updating webcola options.
     * Returns a new simulation and uses the defined layout variable.
     */
    function updateColaLayout(){
        let tempSimulation = cola.d3adaptor(d3)
                         .size([width, height])
                         .avoidOverlaps(layoutOptions.avoidOverlaps)
                         .handleDisconnected(layoutOptions.handleDisconnected);
        
        switch (layoutOptions.layoutType){
            case "jaccardLinkLengths":
                tempSimulation = tempSimulation.jaccardLinkLengths(options.edgeLength)
                break;
            case "flowLayout":
                tempSimulation = tempSimulation.flowLayout(layoutOptions.flowDirection, options.edgeLength);
                break;
            case "linkDistance":
            default:
                tempSimulation = tempSimulation.linkDistance(options.edgeLength);
                break;
        }
        // Bind the nodes and links to the simulation
        return tempSimulation.nodes(nodes)
                            .links(links);
                         
    }

    return {
        addTriplet,
        addEdge,
        removeNode,
        addNode,
        setNodeToColor,
        setSelectNode,
        setClickAway,
        recenterGraph,
        edgeOptions: {
            setStrokeWidth: setEdgeStroke,
            setLength: setEdgeLength,
            setColor: setEdgeColor
        },
        colaOptions: {
            flowLayout: {
                down: () => {
                    layoutOptions.flowDirection = 'y';
                    if (layoutOptions.layoutType == "flowLayout"){
                        simulation.flowLayout(layoutOptions.flowDirection, options.edgeLength);
                    } else {
                        layoutOptions.layoutType = "flowLayout";
                        simulation = updateColaLayout();
                    }

                    restart();
                },
                right: () => {
                    layoutOptions.flowDirection = 'x';
                    if (layoutOptions.layoutType == "flowLayout"){
                        simulation.flowLayout(layoutOptions.flowDirection, options.edgeLength);
                    } else {
                        layoutOptions.layoutType = "flowLayout";
                        simulation = updateColaLayout();
                    }
                    
                    restart();
                }
            }
        }
    }
}
