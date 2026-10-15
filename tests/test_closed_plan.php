<?php
// Command line only: this script must never run from a web request.
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . "/../lib/EnergySimulator.php";
$tmr=100.0;$target=27.0;$min=25.0;$max=29.0;
$pass=0;$fail=0;
function check($n,$c,$d=""){global $pass,$fail;if($c){$pass++;echo "  PASS  $n\n";}else{$fail++;echo "  FAIL  $n   $d\n";}}

// EnergySimulator::computeClosedPlan (docs/PREDICTIVE_CONTROL.md §4).
// Closed period: 10 h, net loss 20 kW (0.2 °C/h), heat pump 100 kW (+0.8 °C/h net).
$closedLoss=array_fill(0,10,20.0);$closedHpOut=array_fill(0,10,100.0);

// C1 heat pump covers every open hour -> opens at target, but still starts LATE
$p=EnergySimulator::computeClosedPlan(27.0,$target,$min,$max,$tmr,$closedLoss,$closedHpOut,array_fill(0,10,-10.0));
check("C1 no buffer",$p["preheat"]===false && $p["buffer_energy"]==0.0,json_encode($p));
check("C1 t_req==target",abs($p["t_req"]-$target)<1e-9);
check("C1 late start 8 (coast, then ramp to target)",$p["start_offset"]===8,"start_offset=".$p["start_offset"]);
check("C1 no banking",$p["bank_hours"]===0);

// C2 short every hour, buffer above the cap
$p=EnergySimulator::computeClosedPlan(27.0,$target,$min,$max,$tmr,$closedLoss,$closedHpOut,array_fill(0,10,50.0));
check("C2 buffer 500 kWh",abs($p["buffer_energy"]-500.0)<1e-9,"buffer=".$p["buffer_energy"]);
check("C2 t_req capped 29",abs($p["t_req"]-$max)<1e-9,"t_req=".$p["t_req"]);
check("C2 bank all 10 open hours",$p["bank_hours"]===10);

// C3 totals balance, but the short hour comes FIRST: needs a buffer
$p=EnergySimulator::computeClosedPlan(27.0,$target,$min,31.0,$tmr,$closedLoss,$closedHpOut,[100.0,-100.0]);
check("C3 t_req 28 (short first hour)",abs($p["t_req"]-28.0)<1e-9,"t_req=".$p["t_req"]);
check("C3 bank only hour 1",$p["bank_hours"]===1,"bank_hours=".$p["bank_hours"]);
check("C3 late start 7",$p["start_offset"]===7,"start_offset=".$p["start_offset"]);

// C4 totals balance, short hour LAST: heat banked in hour 1 carries it
$p=EnergySimulator::computeClosedPlan(27.0,$target,$min,31.0,$tmr,$closedLoss,$closedHpOut,[-100.0,100.0]);
check("C4 t_req = target",abs($p["t_req"]-27.0)<1e-9,"t_req=".$p["t_req"]);
check("C4 bank through hour 2",$p["bank_hours"]===2,"bank_hours=".$p["bank_hours"]);

// C5 closed period too short -> start at once
$p=EnergySimulator::computeClosedPlan(27.0,$target,$min,$max,$tmr,array_fill(0,2,20.0),array_fill(0,2,100.0),array_fill(0,10,100.0));
check("C5 t_req capped 29",abs($p["t_req"]-$max)<1e-9);
check("C5 start 0 (too short)",$p["start_offset"]===0,"start_offset=".$p["start_offset"]);

// C6 long closed period -> very late start, coast floored at min
$p=EnergySimulator::computeClosedPlan(27.0,$target,$min,31.0,$tmr,array_fill(0,30,20.0),array_fill(0,30,100.0),array_fill(0,10,10.0));
check("C6 t_req 28",abs($p["t_req"]-28.0)<1e-9,"t_req=".$p["t_req"]);
check("C6 very late start >=25",$p["start_offset"]>=25,"start_offset=".$p["start_offset"]);

echo "\n$pass passed, $fail failed\n";
exit($fail===0?0:1);
