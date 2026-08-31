"use client";

import { useEffect, useRef, useState } from "react";

type View = "surface" | "nest";
type Point = { x: number; y: number };
type Food = Point & { radius: number; taken: boolean; source?: "spider" };
type StoredFood = Point & { id: number; taken: boolean };
type Target = Point & { food?: Food; stored?: StoredFood; entrance?: boolean; drop?: boolean };
type Ant = Point & {
  kind: "ant"; id: number; angle: number; speed: number; carrying: Food | StoredFood | null;
  target: Target | null; manual: boolean; turn: number; trailClock: number; aggro: number;
  location: View; nestX: number; nestY: number; nestRoute: Point[]; hunger: number; starving: number; dead: boolean;
};
type Spider = Point & {
  kind: "spider"; angle: number; speed: number; target: Point | null; manual: boolean;
  hunger: number; eating: number; meal: Ant | null; prey: Ant | null; gait: number;
  stalkClock: number; pause: number; alive: boolean; hp: number; respawn: number; threatClock: number;
};
type Trail = Point & { power: number };
type DigPath = { points: Point[] };
type Agent = Ant | Spider;

const W = 1600, H = 950, TAU = Math.PI * 2;
const NEST = { x: 790, y: 490, radius: 30 };
const NEST_ENTRANCE = { x: 800, y: 88 };
const BASE_PATHS: Point[][] = [[{x:800,y:55},{x:800,y:210},{x:610,y:310},{x:430,y:390}],[{x:800,y:210},{x:990,y:310},{x:1160,y:410}],[{x:610,y:310},{x:650,y:600}],[{x:990,y:310},{x:950,y:650}]];
const BASE_CHAMBERS = [{x:430,y:390,rx:110,ry:65},{x:1160,y:410,rx:120,ry:70},{x:650,y:650,rx:135,ry:72},{x:950,y:680,rx:150,ry:82}];
type Rock = Point & { rx: number; ry: number; rotation: number; shade: number };
const ROCKS: Rock[] = [
  { x:560, y:130, rx:34, ry:26, rotation:.3, shade:.9 },
  { x:1040, y:140, rx:26, ry:20, rotation:-.2, shade:1.1 },
  { x:150, y:480, rx:30, ry:38, rotation:.15, shade:1 },
  { x:1470, y:460, rx:36, ry:28, rotation:-.4, shade:.85 },
  { x:620, y:830, rx:40, ry:30, rotation:.5, shade:1.05 },
  { x:1010, y:860, rx:28, ry:22, rotation:.1, shade:.95 },
  { x:800, y:300, rx:24, ry:19, rotation:-.3, shade:1.1 },
  { x:1230, y:600, rx:32, ry:24, rotation:.25, shade:.9 },
];
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const distanceSquared = (a: Point, b: Point) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const turnDifference = (from: number, to: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

function makeWorld() {
  let seed = 817233;
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const surfaceFood: Food[] = [];
  const spawnFood = (cx: number, cy: number, count: number, spread: number) => {
    for (let i = 0; i < count; i++) {
      const angle = random() * TAU, radius = Math.sqrt(random()) * spread;
      surfaceFood.push({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius, radius: 5 + random() * 2, taken: false });
    }
  };
  [[280,235,24,65],[1280,235,20,58],[1325,720,26,70],[310,755,18,55]].forEach(v => spawnFood(...v as [number,number,number,number]));
  const ants: Ant[] = Array.from({ length: 30 }, (_, index) => {
    const angle = random() * TAU, radius = 38 + random() * 48;
    return { kind:"ant", id:index+1, x:NEST.x+Math.cos(angle)*radius, y:NEST.y+Math.sin(angle)*radius,
      angle, speed:42+random()*13, carrying:null, target:null, manual:false, turn:(random()-.5)*.6,
      trailClock:0, aggro:0, location:"surface", nestX:800, nestY:110, nestRoute:[], hunger:random()*24, starving:0, dead:false };
  });
  const spider: Spider = { kind:"spider", x:1130, y:520, angle:Math.PI, speed:0, target:null, manual:false,
    hunger:55, eating:0, meal:null, prey:null, gait:0, stalkClock:2.2, pause:0, alive:true, hp:100, respawn:0, threatClock:0 };
  return { ants, spider, surfaceFood, storedFood:[] as StoredFood[], trails:[] as Trail[], digPaths:[] as DigPath[], nextFoodId:1, nextAntId:31, growthClock:30 };
}

export default function Simulation() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const selectedRef = useRef<Agent | null>(null);
  const viewRef = useRef<View>("surface");
  const [view, setViewState] = useState<View>("surface");
  const [toast, setToast] = useState("");
  const [stats, setStats] = useState({ workers:30, field:88, stored:0, spiderHp:100, spiderHunger:55, respawn:0, spiderAlive:true, antHunger:0, antSelected:false });
  const setView = (next: View) => { viewRef.current = next; setViewState(next); };

  useEffect(() => {
    const canvas = canvasRef.current!, context = canvas.getContext("2d")!, world = makeWorld();
    const camera = { scale:1, x:0, y:0 };
    let animationFrame = 0, previous = performance.now(), toastTimer = 0, selectionTimer = 0, hudClock = 0, dragging = false, activeDig: DigPath | null = null;
    const notify = (message: string) => { setToast(message); clearTimeout(toastTimer); toastTimer = window.setTimeout(() => setToast(""), 1700); };
    const activeAnts = () => world.ants.filter(ant => !ant.dead);
    const syncHud = () => { const selected = selectedRef.current; setStats({ workers:activeAnts().length, field:world.surfaceFood.filter(f=>!f.taken).length,
      stored:world.storedFood.filter(f=>!f.taken).length, spiderHp:Math.ceil(world.spider.hp), spiderHunger:Math.round(world.spider.hunger),
      respawn:Math.ceil(world.spider.respawn), spiderAlive:world.spider.alive, antHunger:selected?.kind==="ant"?Math.round(selected.hunger):0,
      antSelected:selected?.kind==="ant" }); };
    const resize = () => { const ratio=Math.min(devicePixelRatio||1,2); canvas.width=innerWidth*ratio; canvas.height=innerHeight*ratio;
      camera.scale=Math.min(canvas.width/W,canvas.height/H); camera.x=(canvas.width-W*camera.scale)/2; camera.y=(canvas.height-H*camera.scale)/2; };
    const pointer = (event: MouseEvent): Point => ({ x:(event.clientX*canvas.width/innerWidth-camera.x)/camera.scale, y:(event.clientY*canvas.height/innerHeight-camera.y)/camera.scale });
    const antPoint = (ant: Ant): Point => ant.location === "surface" ? ant : { x:ant.nestX, y:ant.nestY };
    const nestChambers = () => {const result=[...BASE_CHAMBERS];const extras=Math.max(0,Math.floor((activeAnts().length-30)/5));for(let i=0;i<extras;i++)result.push({x:250+(i%5)*265,y:790+Math.floor(i/5)*95,rx:82,ry:45});return result};
    const growthPaths = () => nestChambers().slice(BASE_CHAMBERS.length).map((chamber,index)=>index===0?[{x:650,y:650},{x:chamber.x,y:chamber.y}]:[{x:nestChambers()[BASE_CHAMBERS.length+index-1].x,y:nestChambers()[BASE_CHAMBERS.length+index-1].y},{x:chamber.x,y:chamber.y}]);
    const nestPaths = () => [...BASE_PATHS,...growthPaths(),...world.digPaths.map(path=>path.points)];
    const pointSegmentDistance = (point:Point,a:Point,b:Point) => {const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;if(!length)return Math.sqrt(distanceSquared(point,a));const t=clamp(((point.x-a.x)*dx+(point.y-a.y)*dy)/length,0,1);return Math.hypot(point.x-(a.x+t*dx),point.y-(a.y+t*dy))};
    const insideChamber = (point:Point,chamber:{x:number;y:number;rx:number;ry:number}) => ((point.x-chamber.x)/(chamber.rx-8))**2+((point.y-chamber.y)/(chamber.ry-8))**2<=1;
    const isNestNavigable = (point:Point) => nestChambers().some(chamber=>insideChamber(point,chamber))||nestPaths().some(path=>path.some((_,index)=>index>0&&pointSegmentDistance(point,path[index-1],path[index])<=15));
    const findNestRoute = (start:Point,end:Point) => {
      type Edge={to:number;cost:number};const nodes:Point[]=[],edges:Edge[][]=[],keys=new Map<string,number>();
      const node=(point:Point)=>{const key=`${Math.round(point.x/3)},${Math.round(point.y/3)}`;const old=keys.get(key);if(old!==undefined)return old;const index=nodes.length;nodes.push({...point});edges.push([]);keys.set(key,index);return index};
      const connect=(a:number,b:number)=>{const cost=Math.sqrt(distanceSquared(nodes[a],nodes[b]));edges[a].push({to:b,cost});edges[b].push({to:a,cost})};
      for(const path of nestPaths())for(let segment=1;segment<path.length;segment++){const from=path[segment-1],to=path[segment],steps=Math.max(1,Math.ceil(Math.sqrt(distanceSquared(from,to))/18));let previous=node(from);for(let step=1;step<=steps;step++){const current=node({x:from.x+(to.x-from.x)*step/steps,y:from.y+(to.y-from.y)*step/steps});if(current!==previous)connect(previous,current);previous=current}}
      for(const chamber of nestChambers()){const center=node(chamber);for(let index=0;index<nodes.length;index++)if(index!==center&&insideChamber(nodes[index],chamber))connect(center,index)}
      const nearest=(point:Point)=>nodes.reduce((best,_,index)=>distanceSquared(point,nodes[index])<distanceSquared(point,nodes[best])?index:best,0),startNode=nearest(start),endNode=nearest(end);
      const distances=nodes.map(()=>Infinity),previous=nodes.map(()=>-1),open=new Set(nodes.map((_,index)=>index));distances[startNode]=0;
      while(open.size){let current=-1;for(const index of open)if(current<0||distances[index]<distances[current])current=index;if(current===endNode||!Number.isFinite(distances[current]))break;open.delete(current);for(const edge of edges[current]){const next=distances[current]+edge.cost;if(next<distances[edge.to]){distances[edge.to]=next;previous[edge.to]=current}}}
      const route:Point[]=[];let cursor=endNode;while(cursor>=0){route.unshift(nodes[cursor]);if(cursor===startNode)break;cursor=previous[cursor]}if(cursor<0)return[];route.push({...end});return route;
    };
    const routeAntInNest = (ant:Ant,end:Point,target:Target) => {if(!isNestNavigable(end))return false;ant.nestRoute=findNestRoute({x:ant.nestX,y:ant.nestY},end);if(!ant.nestRoute.length)return false;ant.target=target;ant.manual=true;return true};

    const addStoredFood = (x=610+Math.random()*80, y=630+Math.random()*45) => world.storedFood.push({ id:world.nextFoodId++, x, y, taken:false });
    const enterNest = (ant: Ant) => { ant.location="nest"; ant.nestX=NEST_ENTRANCE.x+(Math.random()-.5)*8; ant.nestY=NEST_ENTRANCE.y+18; ant.nestRoute=[]; ant.target=null; ant.manual=false;
      if (ant.carrying && "radius" in ant.carrying) { addStoredFood(); ant.carrying=null; } if (ant===selectedRef.current) setView("nest"); syncHud(); };
    const leaveNest = (ant: Ant) => { ant.location="surface"; ant.x=NEST.x+(Math.random()-.5)*18; ant.y=NEST.y+(Math.random()-.5)*18; ant.nestRoute=[]; ant.target=null; ant.manual=false;
      if (ant===selectedRef.current) setView("surface"); };
    const eatStoredFood = (ant: Ant, food: StoredFood) => { if(food.taken)return; food.taken=true; ant.carrying=null; ant.hunger=Math.max(0,ant.hunger-72); ant.starving=0; ant.target=null; ant.manual=false; if(ant===selectedRef.current)notify("WORKER FED"); syncHud(); };
    const killAnt = (ant: Ant) => { ant.dead=true; ant.manual=false; ant.target=null; ant.carrying=null; ant.aggro=0; if(ant===selectedRef.current)notify("SELECTED WORKER STARVED"); syncHud(); };

    const nearestSurfaceFood = (point: Point, radius: number) => { let result:Food|null=null, best=radius*radius; for(const food of world.surfaceFood)if(!food.taken){const d=distanceSquared(point,food);if(d<best){best=d;result=food}}return result; };
    const nearestStoredFood = (point: Point, radius=Infinity) => { let result:StoredFood|null=null,best=radius*radius;for(const food of world.storedFood)if(!food.taken){const d=distanceSquared(point,food);if(d<best){best=d;result=food}}return result; };
    const moveAnt = (ant: Ant, desired: number, dt: number, boost=1) => { ant.angle+=clamp(turnDifference(ant.angle,desired),-2.8*dt,2.8*dt); const speed=ant.speed*boost;
      if(ant.location==="surface"){ant.x+=Math.cos(ant.angle)*speed*dt;ant.y+=Math.sin(ant.angle)*speed*dt;ant.x=clamp(ant.x,18,W-18);ant.y=clamp(ant.y,18,H-18)}
      else {const next={x:clamp(ant.nestX+Math.cos(ant.angle)*speed*dt,45,W-45),y:clamp(ant.nestY+Math.sin(ant.angle)*speed*dt,55,H-42)};if(isNestNavigable(next)){ant.nestX=next.x;ant.nestY=next.y}} };

    const updateAnt = (ant: Ant, dt: number) => {
      if(ant.dead)return; ant.hunger=clamp(ant.hunger+dt*.19,0,100); ant.aggro=Math.max(0,ant.aggro-dt);
      if(ant.hunger>=100){ant.starving+=dt;if(ant.starving>14){killAnt(ant);return}} else ant.starving=0;
      const position=antPoint(ant); let desired=ant.angle, boost=1;
      if(ant.location==="nest"&&ant.nestRoute.length){while(ant.nestRoute.length&&distanceSquared(position,ant.nestRoute[0])<12**2)ant.nestRoute.shift();if(ant.nestRoute.length){desired=Math.atan2(ant.nestRoute[0].y-ant.nestY,ant.nestRoute[0].x-ant.nestX);moveAnt(ant,desired,dt);return}}
      if(ant.manual&&ant.target){const target=ant.target;desired=Math.atan2(target.y-position.y,target.x-position.x);if(distanceSquared(position,target)<110){
        if(target.entrance){ant.location==="surface"?enterNest(ant):leaveNest(ant);return}
        if(target.food&&!target.food.taken){target.food.taken=true;ant.carrying=target.food;ant.target=null;ant.manual=false;syncHud();return}
        if(target.stored&&!target.stored.taken){if(ant.hunger>62)eatStoredFood(ant,target.stored);else{target.stored.taken=true;ant.carrying=target.stored;ant.target=null;ant.manual=false;syncHud()}return}
        if(target.drop&&ant.carrying&&ant.location==="nest"){if("id" in ant.carrying){ant.carrying.x=ant.nestX;ant.carrying.y=ant.nestY;ant.carrying.taken=false}else addStoredFood(ant.nestX,ant.nestY);ant.carrying=null;ant.target=null;ant.manual=false;syncHud();return}
        ant.target=null;ant.manual=false; }
      } else if(ant.location==="surface") {
        if(ant.aggro>0&&world.spider.alive){desired=Math.atan2(world.spider.y-ant.y,world.spider.x-ant.x);boost=1.22}
        else if(ant.hunger>68||ant.carrying){desired=Math.atan2(NEST.y-ant.y,NEST.x-ant.x);if(distanceSquared(ant,NEST)<NEST.radius**2){enterNest(ant);return}}
        else {const food=nearestSurfaceFood(ant,72);if(food)desired=Math.atan2(food.y-ant.y,food.x-ant.x);else{let trail:Trail|null=null,score=0;for(const item of world.trails){const d=distanceSquared(ant,item),value=item.power/(35+Math.sqrt(d));if(d<10000&&value>score){score=value;trail=item}}desired=trail?Math.atan2(trail.y-ant.y,trail.x-ant.x):ant.angle+ant.turn*dt+(Math.random()-.5)*.22}const close=nearestSurfaceFood(ant,9);if(close){close.taken=true;ant.carrying=close;syncHud()}}
        if(ant.carrying){ant.trailClock-=dt;if(ant.trailClock<=0){world.trails.push({x:ant.x,y:ant.y,power:1});ant.trailClock=.2}}
      } else {
        if(ant.hunger>62){const food=nearestStoredFood(position);if(food){if(routeAntInNest(ant,food,{...food,stored:food}))return}else if(routeAntInNest(ant,NEST_ENTRANCE,{...NEST_ENTRANCE,entrance:true}))return}
        else if(ant.carrying){const store={x:650+Math.random()*70,y:650+Math.random()*35};if(routeAntInNest(ant,store,{...store,drop:true}))return}
        else if(routeAntInNest(ant,NEST_ENTRANCE,{...NEST_ENTRANCE,entrance:true}))return
      }
      moveAnt(ant,desired,dt,boost);
    };

    const killSpider = (spider: Spider) => {spider.alive=false;spider.hp=0;spider.respawn=180;spider.speed=0;spider.eating=0;spider.meal=null;spider.prey=null;spider.target=null;spider.manual=false;
      for(let i=0;i<8;i++){const angle=i/8*TAU,radius=10+(i%2)*9;world.surfaceFood.push({x:spider.x+Math.cos(angle)*radius,y:spider.y+Math.sin(angle)*radius,radius:6,taken:false,source:"spider"})}
      world.ants.forEach(ant=>ant.aggro=0);if(selectedRef.current===spider)selectedRef.current=null;notify("SPIDER DEFEATED · 8 FOOD CREATED");syncHud();};
    const updateSpider = (spider: Spider, dt: number) => {
      if(!spider.alive){spider.respawn=Math.max(0,spider.respawn-dt);if(spider.respawn<=0){Object.assign(spider,{alive:true,hp:100,hunger:55,x:1130,y:520,angle:Math.PI,gait:0,stalkClock:2.2});notify("SPIDER RESPAWNED")}return}
      spider.hunger=clamp(spider.hunger+dt*.72,0,100);spider.threatClock-=dt;
      if(spider.threatClock<=0&&(spider.prey||spider.eating>0)){for(const ant of world.ants)if(!ant.dead&&ant.location==="surface"){const distance=Math.sqrt(distanceSquared(spider,ant));if(distance<185&&Math.random()<.4+(185-distance)/260)ant.aggro=Math.max(ant.aggro,9+Math.random()*8)}spider.threatClock=.75}
      let attackers=0;for(const ant of world.ants)if(!ant.dead&&ant.location==="surface"&&ant.aggro>0&&distanceSquared(spider,ant)<34**2)attackers++;spider.hp=clamp(spider.hp-attackers*3.2*dt,0,100);if(spider.hp<=0){killSpider(spider);return}
      if(spider.eating>0){spider.speed=Math.max(0,spider.speed-120*dt);spider.eating-=dt;if(spider.eating<=0){spider.meal=null;spider.hunger=Math.max(0,spider.hunger-68)}return}
      let desired=spider.angle,desiredSpeed=0;
      if(spider.manual&&spider.target){desired=Math.atan2(spider.target.y-spider.y,spider.target.x-spider.x);desiredSpeed=58;if(distanceSquared(spider,spider.target)<130){spider.target=null;spider.manual=false}}
      else {const preyCandidates=world.ants.filter(a=>!a.dead&&a.location==="surface");if((spider.hunger>=42||spider.prey)&&preyCandidates.length){if(!spider.prey||!preyCandidates.includes(spider.prey)){spider.prey=preyCandidates.reduce((best,a)=>distanceSquared(spider,a)<distanceSquared(spider,best)?a:best)}const prey=spider.prey,distance=Math.sqrt(distanceSquared(spider,prey));const lead=clamp(distance/260,.12,.55);desired=Math.atan2(prey.y+Math.sin(prey.angle)*prey.speed*lead-spider.y,prey.x+Math.cos(prey.angle)*prey.speed*lead-spider.x);spider.stalkClock-=dt;if(spider.stalkClock<=0&&distance>125){spider.pause=.35+Math.random()*.55;spider.stalkClock=2+Math.random()*2.4}spider.pause=Math.max(0,spider.pause-dt);desiredSpeed=spider.pause>0?0:distance<135?92:distance<300?52:30;if(distance<18){world.ants.splice(world.ants.indexOf(prey),1);if(selectedRef.current===prey)selectedRef.current=spider;spider.meal=prey;spider.prey=null;spider.eating=12+Math.random()*6;spider.speed=0;for(const ant of world.ants)if(!ant.dead&&ant.location==="surface"&&distanceSquared(spider,ant)<220**2)ant.aggro=Math.max(ant.aggro,12+Math.random()*7);syncHud()}}
        else{spider.prey=null;spider.angle+=(Math.random()-.5)*dt*.3;desiredSpeed=spider.hunger>25?12:0}}
      const diff=turnDifference(spider.angle,desired),turnRate=.65+Math.min(spider.speed/45,1.2);spider.angle+=clamp(diff,-turnRate*dt,turnRate*dt);const acceleration=desiredSpeed>spider.speed?34:58;spider.speed+=clamp(desiredSpeed-spider.speed,-acceleration*dt,acceleration*dt);spider.gait+=dt*(1.3+spider.speed*.075);spider.x=clamp(spider.x+Math.cos(spider.angle)*spider.speed*dt,35,W-35);spider.y=clamp(spider.y+Math.sin(spider.angle)*spider.speed*dt,35,H-35);
    };

    const growColony = (dt: number) => {world.growthClock-=dt;const stored=world.storedFood.filter(f=>!f.taken);if(world.growthClock<=0&&stored.length>=6&&activeAnts().length<60){stored[0].taken=true;stored[1].taken=true;const id=world.nextAntId++;world.ants.push({kind:"ant",id,x:NEST.x,y:NEST.y,angle:Math.PI/2,speed:45+Math.random()*10,carrying:null,target:null,manual:false,turn:(Math.random()-.5)*.6,trailClock:0,aggro:0,location:"nest",nestX:650+Math.random()*80,nestY:630+Math.random()*35,nestRoute:[],hunger:10,starving:0,dead:false});world.growthClock=28;notify("NEW WORKER · NEST EXPANDED");syncHud()}};

    const drawSurfaceGround = () => {context.fillStyle="#6f4b2e";context.fillRect(0,0,W,H);let seed=22917;const random=()=> (seed=(seed*1664525+1013904223)>>>0)/4294967296;for(let i=0;i<800;i++){context.globalAlpha=.14;context.fillStyle=random()>.5?"#26180f":"#d0a06d";context.fillRect(random()*W,random()*H,random()*2+1,random()*2+1)}context.globalAlpha=1;const gradient=context.createRadialGradient(NEST.x,NEST.y,3,NEST.x,NEST.y,70);gradient.addColorStop(0,"#060504");gradient.addColorStop(.42,"#17100a");gradient.addColorStop(.5,"#8c633d");gradient.addColorStop(1,"#5a371f00");context.fillStyle=gradient;context.beginPath();context.arc(NEST.x,NEST.y,70,0,TAU);context.fill();context.fillStyle="#efd091";context.font="bold 10px monospace";context.textAlign="center";context.fillText("NEST ENTRANCE",NEST.x,NEST.y+69)};
    const drawNest = () => {context.fillStyle="#332116";context.fillRect(0,0,W,H);context.fillStyle="#745035";context.fillRect(0,0,W,58);context.fillStyle="#20150f";context.fillRect(0,58,W,H-58);context.strokeStyle="#9a6841";context.lineWidth=36;context.lineCap="round";context.lineJoin="round";
      for(const path of [...BASE_PATHS,...growthPaths()]){context.beginPath();context.moveTo(path[0].x,path[0].y);path.slice(1).forEach(p=>context.lineTo(p.x,p.y));context.stroke()}
      context.fillStyle="#9a6841";for(const chamber of nestChambers()){context.beginPath();context.ellipse(chamber.x,chamber.y,chamber.rx,chamber.ry,0,0,TAU);context.fill()}
      context.strokeStyle="#a8754d";context.lineWidth=28;for(const path of world.digPaths){if(path.points.length<2)continue;context.beginPath();context.moveTo(path.points[0].x,path.points[0].y);path.points.slice(1).forEach(p=>context.lineTo(p.x,p.y));context.stroke()}context.fillStyle="#e8c183";context.font="bold 10px monospace";context.fillText("SURFACE EXIT",800,45);context.fillText("FOOD STORES",650,745);};
    const drawAnt = (ant: Ant) => {const point=antPoint(ant);context.save();context.translate(point.x,point.y);context.rotate(ant.angle);if(ant===selectedRef.current||ant.aggro>0){context.strokeStyle=ant===selectedRef.current?"#ffe74d":"#df493c";context.lineWidth=2;context.beginPath();context.arc(0,0,15,0,TAU);context.stroke()}context.globalAlpha=ant.dead?.55:1;context.fillStyle=ant.dead?"#776a5e":ant===selectedRef.current?"#ffe23d":ant.aggro>0?"#5d1713":"#15120f";context.strokeStyle="#050403";for(const y of [-4,4])for(const x of [-2,4]){context.beginPath();context.moveTo(x,y/2);context.lineTo(x+5,y*1.7);context.stroke()}context.beginPath();context.ellipse(-5,0,5,3.5,0,0,TAU);context.ellipse(1,0,4,3,0,0,TAU);context.ellipse(6,0,3.5,3,0,0,TAU);context.fill();if(ant.carrying){context.fillStyle="#d6a43f";context.beginPath();context.arc(12,0,5,0,TAU);context.fill()}context.restore()};
    const drawSpider = (spider: Spider) => {context.save();context.translate(spider.x,spider.y);context.rotate(spider.angle);const chosen=spider===selectedRef.current;context.strokeStyle=chosen?"#fff1a0":"#100c09";context.lineCap="round";for(const side of [-1,1])for(let i=0;i<4;i++){const hip=-9+i*6,phase=spider.gait+(i%2?Math.PI:0)+(side<0?Math.PI:0),stride=Math.sin(phase)*Math.min(7,spider.speed*.085),lift=(1-Math.cos(phase))*.8,kx=hip+(i-1.5)*5+stride*.35,ky=side*(17+i*1.7-lift),fx=hip+(i-1.5)*11+stride,fy=side*(34+i*2-lift*2);context.lineWidth=3;context.beginPath();context.moveTo(hip,side*4);context.lineTo(kx,ky);context.lineTo(fx,fy);context.stroke()}context.fillStyle=chosen?"#ffe23d":"#2a211b";context.beginPath();context.ellipse(-7,0,12,10,0,0,TAU);context.ellipse(9,0,9,8,0,0,TAU);context.fill();context.stroke();context.restore()};
    const drawRocks = () => {for(const rock of ROCKS){context.save();context.translate(rock.x,rock.y);context.rotate(rock.rotation);context.fillStyle=`rgba(125,115,106,${clamp(rock.shade,.75,1)})`;context.strokeStyle="#4c443d";context.lineWidth=3;context.beginPath();context.ellipse(0,0,rock.rx,rock.ry,0,0,TAU);context.fill();context.stroke();context.fillStyle="rgba(255,244,230,.13)";context.beginPath();context.ellipse(-rock.rx*.28,-rock.ry*.3,rock.rx*.5,rock.ry*.4,0,0,TAU);context.fill();context.restore()}};

    const render = () => {const ratio=canvas.width/innerWidth;context.setTransform(ratio,0,0,ratio,0,0);context.fillStyle="#21150d";context.fillRect(0,0,innerWidth,innerHeight);context.setTransform(camera.scale,0,0,camera.scale,camera.x,camera.y);
      if(viewRef.current==="surface"){drawSurfaceGround();drawRocks();for(const trail of world.trails){context.globalAlpha=trail.power*.25;context.fillStyle="#efb64d";context.beginPath();context.arc(trail.x,trail.y,2.5,0,TAU);context.fill()}context.globalAlpha=1;for(const food of world.surfaceFood)if(!food.taken){context.fillStyle=food.source?"#a94130":"#d7a43e";context.beginPath();context.arc(food.x,food.y,food.radius,0,TAU);context.fill()}world.ants.filter(a=>a.location==="surface").forEach(drawAnt);if(world.spider.alive)drawSpider(world.spider)}
      else {drawNest();for(const food of world.storedFood)if(!food.taken){context.fillStyle="#d7a43e";context.strokeStyle="#6e4316";context.beginPath();context.arc(food.x,food.y,6,0,TAU);context.fill();context.stroke()}world.ants.filter(a=>a.location==="nest").forEach(drawAnt)}
      const selected=selectedRef.current,target=selected?.target;if(selected&&target&&((selected.kind==="spider"&&viewRef.current==="surface")||(selected.kind==="ant"&&selected.location===viewRef.current))){const from=selected.kind==="ant"?antPoint(selected):selected;context.strokeStyle="#ffe54d";context.setLineDash([5,6]);context.beginPath();context.moveTo(from.x,from.y);context.lineTo(target.x,target.y);context.stroke();context.setLineDash([])}};

    const tick = (now: number) => {const dt=Math.min((now-previous)/1000,.04);previous=now;world.ants.forEach(ant=>updateAnt(ant,dt));updateSpider(world.spider,dt);growColony(dt);for(let i=world.trails.length-1;i>=0;i--){world.trails[i].power-=dt*.055;if(world.trails[i].power<=0)world.trails.splice(i,1)}hudClock-=dt;if(hudClock<=0){syncHud();hudClock=.25}render();animationFrame=requestAnimationFrame(tick)};

    const hitAnt = (point: Point) => {let result:Ant|null=null,best=20**2;for(const ant of world.ants)if(ant.location===viewRef.current){const d=distanceSquared(point,antPoint(ant));if(d<best){best=d;result=ant}}return result};
    const click = (event: MouseEvent) => {if(dragging)return;const point=pointer(event);if(viewRef.current==="surface"&&world.spider.alive&&distanceSquared(point,world.spider)<28**2){selectedRef.current=world.spider;world.spider.target=null;world.spider.manual=true;notify("SPIDER SELECTED");syncHud();return}const hit=hitAnt(point);if(hit){const choose=()=>{selectedRef.current=hit;hit.target=null;hit.nestRoute=[];hit.manual=true;notify(hit.dead?`WORKER ${hit.id} · DECEASED`:`WORKER ${String(hit.id).padStart(2,"0")} SELECTED`);syncHud()};if(selectedRef.current?.kind==="spider"){clearTimeout(selectionTimer);selectionTimer=window.setTimeout(choose,220)}else choose();return}const selected=selectedRef.current;if(!selected)return;if(selected.kind==="spider"){if(viewRef.current!=="surface"||!selected.alive)return;selected.prey=null;selected.target=point;selected.manual=true;return}if(selected.dead||selected.location!==viewRef.current)return;if(selected.location==="surface"&&distanceSquared(point,NEST)<55**2){selected.target={...NEST_ENTRANCE,x:NEST.x,y:NEST.y,entrance:true};selected.manual=true;return}if(selected.location==="nest"){if(distanceSquared(point,NEST_ENTRANCE)<55**2){routeAntInNest(selected,NEST_ENTRANCE,{...NEST_ENTRANCE,entrance:true});return}if(!routeAntInNest(selected,point,{...point,drop:Boolean(selected.carrying)}))notify("SOLID EARTH · DIG A TUNNEL FIRST");return}selected.target={...point};selected.manual=true};
    const doubleClick = (event: MouseEvent) => {clearTimeout(selectionTimer);const point=pointer(event),selected=selectedRef.current;if(selected?.kind==="spider"&&viewRef.current==="surface"){const prey=hitAnt(point);if(prey&&!prey.dead){selected.prey=prey;selected.target=null;selected.manual=false;selected.pause=0;notify(`HUNTING WORKER ${String(prey.id).padStart(2,"0")}`)}return}if(selected?.kind!=="ant"||selected.dead||selected.location!==viewRef.current){notify("SELECT A LIVING ANT FIRST");return}if(viewRef.current==="surface"){const food=nearestSurfaceFood(point,20);if(food){selected.target={...food,food};selected.manual=true;notify("FOOD PICKUP ROUTE SET")}}else{const food=nearestStoredFood(point,20);if(food&&routeAntInNest(selected,food,{...food,stored:food}))notify(selected.hunger>62?"FOOD EATING ROUTE SET":"FOOD MOVE ROUTE SET")}};
    const pointerDown = (event: MouseEvent) => {if(viewRef.current!=="nest")return;const selected=selectedRef.current;if(selected?.kind!=="ant"||selected.dead||selected.location!=="nest")return;const point=pointer(event);if(distanceSquared(point,antPoint(selected))>80**2)return;dragging=true;selected.nestRoute=[];activeDig={points:[{x:selected.nestX,y:selected.nestY},point]};world.digPaths.push(activeDig);selected.target={...point};selected.manual=true;notify("DIGGING TUNNEL")};
    const pointerMove = (event: MouseEvent) => {if(!dragging||!activeDig)return;const point=pointer(event),last=activeDig.points.at(-1)!;if(distanceSquared(point,last)>12**2){activeDig.points.push(point);const selected=selectedRef.current;if(selected?.kind==="ant"){selected.target={...point};selected.manual=true}}};
    const pointerUp = () => {if(dragging){dragging=false;activeDig=null;notify("TUNNEL COMPLETE")}};
    resize();syncHud();addEventListener("resize",resize);canvas.addEventListener("click",click);canvas.addEventListener("dblclick",doubleClick);canvas.addEventListener("mousedown",pointerDown);canvas.addEventListener("mousemove",pointerMove);addEventListener("mouseup",pointerUp);animationFrame=requestAnimationFrame(tick);
    return()=>{cancelAnimationFrame(animationFrame);clearTimeout(toastTimer);clearTimeout(selectionTimer);removeEventListener("resize",resize);removeEventListener("mouseup",pointerUp);canvas.removeEventListener("click",click);canvas.removeEventListener("dblclick",doubleClick);canvas.removeEventListener("mousedown",pointerDown);canvas.removeEventListener("mousemove",pointerMove)};
  }, []);

  return <section className="simulation"><canvas ref={canvasRef}/><div className="viewSwitch"><button className={view==="surface"?"active":""} onClick={()=>setView("surface")}>GROUND</button><button className={view==="nest"?"active":""} onClick={()=>setView("nest")}>NEST</button></div><div className="hud brand"><em>ANT // 02</em><h1>BLACKWOOD<br/>COLONY</h1><p>{view==="surface"?"FORAGING OBSERVATION":"NEST CROSS-SECTION"}</p></div><div className="hud stats"><Stat title="STORED FOOD" value={stats.stored} unit="PELLETS"/><Stat title="WORKERS" value={stats.workers} unit="LIVING"/><Stat title="FIELD FOOD" value={stats.field} unit="REMAINING"/></div><div className="hud spiderHud"><span>SPIDER VITALS</span><strong>{stats.spiderAlive?`${stats.spiderHp} HP`:"DEAD"}</strong><i><b style={{width:`${stats.spiderHp}%`}}/></i><small>{stats.spiderAlive?`HUNGER · ${stats.spiderHunger}%`:`RESPAWN · ${formatTime(stats.respawn)}`}</small>{stats.antSelected&&<><span className="antHungerLabel">SELECTED ANT HUNGER · {stats.antHunger}%</span><i className="hungerBar"><b style={{width:`${stats.antHunger}%`}}/></i></>}</div><div className="hud mode"><b>● {view==="surface"?"FORAGE MODE":"COLONY INTERIOR"}</b><small>{view==="nest"?" DRAG FROM SELECTED ANT TO DIG":" PHEROMONE NETWORK ACTIVE"}</small></div><div className="hud help">{view==="surface"?<><b>CLICK CREATURE</b> SELECT<br/><b>DOUBLE-CLICK FOOD / ANT</b> PICKUP / HUNT<br/><b>CLICK NEST</b> ENTER WITH ANT</>:<><b>CLICK ANT</b> SELECT<br/><b>DRAG NEAR ANT</b> DIG TUNNEL<br/><b>DOUBLE-CLICK FOOD</b> EAT / MOVE<br/><b>CLICK EXIT</b> RETURN TO GROUND</>}</div>{toast&&<div className="hud toast">{toast}</div>}</section>;
}

function Stat({title,value,unit}:{title:string;value:number;unit:string}){return <div className="stat"><span>{title}</span><strong>{String(value).padStart(3,"0")}</strong><small> {unit}</small></div>}
function formatTime(seconds:number){return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,"0")}`}
