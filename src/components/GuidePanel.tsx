/** Short version of the team's QA Seed Data Guide (full text: .claude/skills/qa-seed-data/SKILL.md). */
export function GuidePanel() {
  return (
    <details className="card guide">
      <summary>
        <strong>راهنمای Seed Data</strong>
        <span className="hint"> — چه زمانی Seed Data بسازیم، کجا نگه داریم و چطور نام‌گذاری کنیم</span>
      </summary>
      <div className="guide-body">
        <p className="principle">
          <b>Test Case</b> می‌گوید چه چیزی را تست کنیم. <b>Seed Data</b> می‌گوید تست را با چه داده‌ای اجرا کنیم. Zephyr محل اجرای Test Case و
          ثبت Test Data ساده است و Confluence محل نگهداری Seed Dataهای مشترک، پیچیده و قابل استفادهٔ مجدد.
        </p>

        <div className="guide-grid">
          <section>
            <h4>چه زمانی Seed Data بسازیم؟</h4>
            <ul>
              <li>داده در چند Test Case استفاده می‌شود</li>
              <li>ساخت داده پیچیده یا زمان‌بر است</li>
              <li>داده باید وضعیت (Status) مشخصی داشته باشد</li>
              <li>چند QA به یک دادهٔ مشترک نیاز دارند</li>
              <li>برای تست یک Feature مجموعه‌ای از داده‌های مرتبط لازم است</li>
            </ul>
            <p className="hint">اگر داده ساده است و فقط در یک Test Case استفاده می‌شود، همان‌جا در Zephyr ثبت شود.</p>
          </section>

          <section>
            <h4>Naming Convention</h4>
            <p>
              <code dir="ltr">SD-[ENTITY]-[DESCRIPTION]-[NUMBER]</code>
            </p>
            <p className="examples" dir="ltr">
              SD-VENDOR-ACTIVE-001 · SD-VENDOR-INACTIVE-001 · SD-ORDER-PENDING-001 · SD-ORDER-PAID-001
            </p>
            <h4>قوانین</h4>
            <ul>
              <li>قبل از ساخت Seed Data جدید، موارد موجود را جستجو کنید.</li>
              <li>Status را همیشه مشخص کنید؛ مثلاً Order Status: Pending.</li>
              <li>Password، Token، Secret و اطلاعات واقعی مشتری ثبت نکنید.</li>
              <li>جزئیات را در Test Case کپی نکنید؛ فقط Reference بدهید.</li>
              <li>QA دیگری باید بدون توضیح شما بفهمد داده چیست و برای چه تستی است.</li>
            </ul>
          </section>
        </div>

        <h4>چه چیزی در Zephyr باشد و چه چیزی در Confluence؟</h4>
        <div className="table-scroll">
          <table className="plain">
            <thead>
              <tr>
                <th />
                <th>Zephyr</th>
                <th>Confluence</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Test Steps و Expected Result', '✅', '❌'],
                ['Test Data ساده (فقط یک Test Case)', '✅', '❌'],
                ['دادهٔ قابل استفادهٔ مجدد', 'Reference', '✅'],
                ['دادهٔ پیچیده (چند Entity یا وضعیت خاص)', 'Reference', '✅'],
                ['روش ساخت داده', 'در صورت نیاز', '✅'],
                ['توضیحات کامل Seed Data', '❌', '✅'],
              ].map(([what, zephyr, confluence]) => (
                <tr key={what}>
                  <th scope="row">{what}</th>
                  <td>{zephyr}</td>
                  <td>{confluence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h4>اتصال Seed Data به Test Case در Zephyr</h4>
        <pre dir="ltr">{`Precondition: Vendor is active and a pending order exists.

Test Data:
SD-VENDOR-ACTIVE-001
SD-ORDER-PENDING-001`}</pre>
      </div>
    </details>
  );
}
