<?php
require "/home/user/HeatAQ/lib/EnergySimulator.php";
$tmr=100.0;$target=27.0;$min=25.0;$max=29.0;
$pass=0;$fail=0;
function check($n,$c,$d=""){global $pass,$fail;if($c){$pass++;echo "  PASS  $n\n";}else{$fail++;echo "  FAIL  $n   $d\n";}}

$closedLoss=array_fill(0,10,20.0);$closedHpOut=array_fill(0,10,100.0);

// C1 no preheat
$p=EnergySimulator::computeClosedPlan(27.0,$target,$min,$max,$tmr,$closedLoss,$closedHpOut,900.0,1000.0);
check("C1 no preheat flag",$p["preheat"]===false,json_encode($p));
check("C1 t_req==target",abs($p["t_req"]-$target)<1e-9);
check("C1 buffer 0",$p["buffer_energy"]==0.0);

// C2 preheat, capped at max
$p=EnergySimulator::computeClosedPlan(27.0,$target,$min,$max,$tmr,$closedLoss,$closedHpOut,1500.0,1000.0);
check("C2 preheat flag",$p["preheat"]===true,json_encode($p));
check("C2 t_req capped 29",abs($p["t_req"]-$max)<1e-9,"t_req=".$p["t_req"]);
check("C2 buffer 500",abs($p["buffer_energy"]-500.0)<1e-9);

// C3 preheat uncapped, late start
$p=EnergySimulator::computeClosedPlan(27.0,$target,$min,31.0,$tmr,$closedLoss,$closedHpOut,1200.0,1000.0);
check("C3 t_req 29",abs($p["t_req"]-29.0)<1e-9,"t_req=".$p["t_req"]);
check("C3 late start offset 6",$p["start_offset"]===6,"start_offset=".$p["start_offset"]);

// C4 too short -> start 0
$cl2=array_fill(0,2,20.0);$ch2=array_fill(0,2,100.0);
$p=EnergySimulator::computeClosedPlan(27.0,$target,$min,$max,$tmr,$cl2,$ch2,2000.0,1000.0);
check("C4 preheat flag",$p["preheat"]===true);
check("C4 t_req capped 29",abs($p["t_req"]-$max)<1e-9);
check("C4 start 0 (too short)",$p["start_offset"]===0,"start_offset=".$p["start_offset"]);

// C5 long closed period -> very late start, coast floored at min
$cl5=array_fill(0,30,20.0);$ch5=array_fill(0,30,100.0);
$p=EnergySimulator::computeClosedPlan(27.0,$target,$min,31.0,$tmr,$cl5,$ch5,1100.0,1000.0);
check("C5 t_req 28",abs($p["t_req"]-28.0)<1e-9,"t_req=".$p["t_req"]);
check("C5 very late start >=25",$p["start_offset"]>=25,"start_offset=".$p["start_offset"]);

echo "\n$pass passed, $fail failed\n";
exit($fail===0?0:1);
