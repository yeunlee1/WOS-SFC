const PETALS = [
  { left:'4%',  delay:'0s',    dur:'7s',  size:'18px', rot:15  },
  { left:'12%', delay:'1.2s',  dur:'9s',  size:'13px', rot:-20 },
  { left:'21%', delay:'2.8s',  dur:'6.5s',size:'22px', rot:30  },
  { left:'30%', delay:'0.5s',  dur:'8s',  size:'15px', rot:-10 },
  { left:'39%', delay:'3.5s',  dur:'7.5s',size:'19px', rot:25  },
  { left:'48%', delay:'1.8s',  dur:'6s',  size:'12px', rot:-35 },
  { left:'57%', delay:'4.2s',  dur:'8.5s',size:'20px', rot:10  },
  { left:'66%', delay:'0.9s',  dur:'7s',  size:'14px', rot:-25 },
  { left:'74%', delay:'2.4s',  dur:'9.5s',size:'17px', rot:40  },
  { left:'82%', delay:'3.1s',  dur:'6.8s',size:'21px', rot:-15 },
  { left:'90%', delay:'1.5s',  dur:'8s',  size:'13px', rot:20  },
  { left:'96%', delay:'4.8s',  dur:'7.2s',size:'16px', rot:-30 },
];

export default function Petals() {
  return (
    <div className="petals-bg" aria-hidden="true">
      {PETALS.map((p, i) => (
        <div
          key={i}
          className="petal"
          style={{
            left: p.left,
            animationDelay: p.delay,
            animationDuration: p.dur,
            fontSize: p.size,
            '--rot': `${p.rot}deg`,
          }}
        >
          🌸
        </div>
      ))}
    </div>
  );
}
