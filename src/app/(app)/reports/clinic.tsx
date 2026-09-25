import { BarList, Meter } from "@/components/charts/bar-list";
import { PeakHours } from "@/components/charts/heatmap";
import { TrendChart } from "@/components/charts/trend-chart";
import { sentence } from "@/lib/format";
import { bucketLabel, pctChange, type OperationsReport } from "@/lib/reports";
import { Panel, StatTile } from "./parts";

const SOURCE: Record<string, string> = { phone: "Phone call", whatsapp: "WhatsApp", in_person: "At the desk", online: "Online", walk_in: "Walk-in" };
const DX: Record<string, string> = { ultrasound: "Ultrasound", imaging: "X-ray / imaging", lab: "Lab tests", rapid_test: "Rapid tests", other: "Other" };

export function ClinicReport({ r, prev }: { r: OperationsReport; prev: OperationsReport | null }) {
  const g = r.range.grain;
  const v = r.visits, c = r.customers, a = r.appointments, vx = r.vaccinations;
  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile hero label="Visits" value={v.total} delta={prev ? pctChange(v.total, prev.visits.total) : null}
          explain={`${v.pets} different pets · about ${v.per_day} a day · ${v.urgent} urgent/emergency`} />
        <StatTile label="New owners" value={c.new} delta={prev ? pctChange(c.new, prev.customers.new) : null}
          explain={`First-ever visit in this period. ${c.returning} returning owners also came in.`} />
        <StatTile label="Median wait" value={v.median_wait_min} suffix=" min" upIsGood={false}
          explain={`From check-in to seeing the doctor. A typical visit then takes ${v.median_visit_min ?? "—"} min.`} />
        <StatTile label="Missed appointments" value={a.no_show_rate} suffix="%" tone={(a.no_show_rate ?? 0) > 15 ? "warning" : undefined}
          explain={`${a.no_show} no-shows of ${a.total} bookings · ${a.cancel_rate ?? 0}% cancelled in advance`} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Panel title="Visits over time" className="lg:col-span-2" note={g === "day" ? "Per day" : g === "week" ? "Per week" : "Per month"}>
          <TrendChart kind="bar" series={[{ name: "Visits", color: "var(--viz-1)" }]}
            points={r.series.map((s) => ({ label: bucketLabel(s.bucket, g), longLabel: bucketLabel(s.bucket, g, true), values: [s.visits] }))} />
        </Panel>
        <Panel title="Vaccinations" note="Vaccines that fell due in this period">
          <div className="grid gap-4">
            <Meter value={vx.due.completion_rate} label="Given" />
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-muted-foreground">Doses given</dt><dd className="text-xl font-bold tabular">{vx.doses}</dd></div>
              <div><dt className="text-muted-foreground">On time (±7 days)</dt><dd className="text-xl font-bold tabular">{vx.due.done_on_time}</dd></div>
              <div><dt className="text-muted-foreground">Still pending</dt><dd className="font-semibold tabular">{vx.due.still_pending}</dd></div>
              <div><dt className="text-muted-foreground">Skipped</dt><dd className="font-semibold tabular">{vx.due.skipped}</dd></div>
            </dl>
            <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
              <b>{vx.overdue_now}</b> overdue right now, for {vx.overdue_pets} pet(s)
            </p>
          </div>
        </Panel>
      </div>

      <Panel title="Busiest hours" note="Check-ins by weekday and hour — useful for staff rosters">
        <PeakHours cells={r.peak_hours} />
      </Panel>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="Doctor workload" note="Visits seen · median minutes per visit">
          <BarList items={r.by_doctor.map((d) => ({ label: d.label, value: d.visits, sub: d.median_visit_min != null ? `${d.median_visit_min} min` : undefined }))} unit="visits" />
        </Panel>
        <Panel title="Visit types">
          <BarList items={r.by_type.map((t) => ({ label: t.label, value: t.visits }))} unit="visits" />
        </Panel>
        <Panel title="Pets seen, by species">
          <BarList items={r.by_species.map((t) => ({ label: t.label, value: t.pets }))} unit="pets" />
        </Panel>
        <Panel title="How new owners found us" note={`${c.registered} owners registered in this period`}>
          <BarList items={c.referrals.map((t) => ({ label: t.label, value: t.customers }))} empty="No new registrations" />
        </Panel>
        <Panel title="Bookings by channel">
          <BarList items={a.by_source.map((t) => ({ label: SOURCE[t.label] ?? sentence(t.label), value: t.appointments }))} empty="No appointments booked" />
        </Panel>
        <Panel title="Owners to win back" note="Active owners whose last visit was 6–18 months ago">
          <p className="text-3xl font-bold tabular">{c.lapsed}</p>
          <p className="mt-1 text-sm text-muted-foreground">Good candidates for a check-up or vaccination campaign in <b className="text-foreground">Messages → Campaigns</b>.</p>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Panel title="Surgery" note={`${r.surgery.total} planned or done · ${r.surgery.completed} discharged · ${r.surgery.emergency} emergency`}>
          <BarList items={r.surgery.by_procedure.map((t) => ({ label: t.label, value: t.surgeries }))} empty="No surgeries in this period" />
        </Panel>
        <Panel title="Tests & scans" note={`${r.diagnostics.total} ordered · ${r.diagnostics.resulted} with results`}>
          <BarList items={r.diagnostics.by_category.map((t) => ({ label: DX[t.label] ?? t.label, value: t.tests }))} empty="No tests ordered" />
        </Panel>
        <Panel title="Ward">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-muted-foreground">Admissions</dt><dd className="text-2xl font-bold tabular">{r.ward.admissions}</dd></div>
            <div><dt className="text-muted-foreground">Average stay</dt><dd className="text-2xl font-bold tabular">{r.ward.average_stay_days ?? "—"}<span className="text-sm font-medium"> days</span></dd></div>
          </dl>
        </Panel>
      </div>
    </div>
  );
}
