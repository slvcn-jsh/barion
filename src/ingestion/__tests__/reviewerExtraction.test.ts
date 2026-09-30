import { extractConceptTargets } from '@/ingestion/concepts';
import { AUTO_PUBLISH_QUALITY_SCORE, createTargetedExtractiveDrafts } from '@/ingestion/drafts';
import { createStudyGuide } from '@/ingestion/studyGuide';
import { planConceptBatches } from '@/ai/batchGeneration';
import { generateGroundedCardsWithFallback } from '@/ai/generate';
import { selectCandidatesForAutomaticStudy } from '@/ai/candidateSelection';
import type { ParsedSegment } from '@/ingestion/types';

const REVIEWER_SEGMENTS: ParsedSegment[] = [
  {
    id: 'seg-1',
    locator: 'Page 1',
    sectionPath: 'Methods of Birth Control',
    text: `University Health Service, University of Rochester – Call 585-275-2662 to schedule an appointment. Rev. 7/19

Contraception (or birth control), the voluntary prevention of pregnancy, is one of the most frequent reasons for gynecological visits at the University Health Service. Using contraception reflects the maturity of a couple engaging in sexual intercourse, ensuring that conception occurs by choice rather than chance.

You may have heard that "You can't get pregnant the first time." This is a myth. Fertilization can take place any time sperm are present in a woman's genital tract when an egg is present. Although some women ovulate and menstruate with precise regularity, most women will experience some variability in their cycle length, making it difficult to determine when they are fertile. A woman is usually considered fertile "in the middle" of the cycle, but unexpected ovulation can occur any day of the cycle, occasionally even during her period. Statistics show that 80-90% of sexually active women not using a birth control method will become pregnant within one year.`,
    startOffset: 0,
    endOffset: 800,
  },
  {
    id: 'seg-2',
    locator: 'Page 1',
    sectionPath: 'Methods of Birth Control',
    text: `QUESTIONS TO CONSIDER
• How safe is the method? Are there any side effects?
• How effective is the method?

STIs AND CONTRACEPTION
If you are sexually active, you should be concerned about protection against sexually transmitted infections (STIs) as well as unintended pregnancy. Hormonal methods of birth control, such as birth control pills, are very effective for preventing unplanned pregnancy, but they do not offer protection from STIs. As you choose the method of birth control that is best for you, you should also think about protecting yourself against the transmission of STIs by using a barrier method/condom.

SCHEDULING AN APPOINTMENT
All visits to UHS are confidential.`,
    startOffset: 801,
    endOffset: 1500,
  },
  {
    id: 'seg-3',
    locator: 'Page 1',
    sectionPath: 'Methods of Birth Control',
    text: `Both men and women are encouraged to seek information about the various contraceptive methods from a UHS health care provider. On the UHS web site, you will find fact sheets about contraceptive choices.

Some prescription and non-prescription contraceptive products are available for purchase at UHS. You can purchase birth control pills at UHS at a cost lower than in area pharmacies.

CONTRACEPTION OPTIONS
In order to make an informed decision about contraception, it is important to weigh the pros and cons of each option.
The chart on the following page provides an overview of the following contraceptive options. Fact sheets are available on the UHS web site for the options noted with a *.
• Birth Control Pills (Oral Contraceptives) *
• Condoms and Spermicidal Foam *
• Contraceptive Patch *
• Depo-Provera *
• I.U.D.
• Nexplanon
• Vaginal Contraceptive Ring
The following methods of contraception are described briefly below. Fact sheets are available for methods noted with a *.
• Abstinence *
• Fertility Awareness (Natural Family Planning) *
• Withdrawal
• Sterilization`,
    startOffset: 1501,
    endOffset: 2500,
  },
  {
    id: 'seg-4',
    locator: 'Page 1',
    sectionPath: 'Methods of Birth Control',
    text: `Abstinence: Abstinence is the most effective method of birth control. With abstinence, pregnancy is avoided by choosing not to have sexual intercourse with another person. Abstinence is 100% effective in preventing pregnancy. The effectiveness of abstinence in preventing sexually transmitted infections varies depending on one’s definition of abstinence. It is possible to contract STIs during oral sex.

Fertility Awareness: This method involves monitoring basal body temperature, cervical position, and cervical mucous to determine when fertility is most likely. Abstinence is required for a period of time when using this method. This method, which is about 80% effective, is considered most appropriate for committed couples who strongly wish to avoid other forms of birth control and for whom avoiding a pregnancy is not essential.

Withdrawal: With withdrawal, the male does not ejaculate inside the woman or around the woman’s vagina. Withdrawal is not an effective form of birth control. It is unreliable and ineffective. Even if this method is used perfectly every time, 25% of women will become pregnant the first year.`,
    startOffset: 2501,
    endOffset: 3500,
  },
  {
    id: 'seg-5',
    locator: 'Page 1',
    sectionPath: 'Methods of Birth Control',
    text: `Sterilization : Since sterilization is a permanent method of contraception, the decision to choose sterilization as the method of contraception should be made after the decision to have no more children has been well thought through. Sterilization involves a brief surgical procedure for the man (vasectomy) or the woman (tubal ligation) or Essure, a permanent non-surgical procedure that is placed in the Fallopian tube. Sterilization procedures are very difficult and expensive to try to reverse to become fertile again. They do not provide protection from sexually transmitted diseases.`,
    startOffset: 3501,
    endOffset: 4200,
  },
  {
    id: 'seg-6',
    locator: 'Page 2',
    sectionPath: 'STIs and Pregnancy',
    text: `STIs and Pregnancy: Prevention includes the combination of a barrier (condom) and contraception.`,
    startOffset: 4201,
    endOffset: 4400,
  },
  {
    id: 'seg-7',
    locator: 'Page 2',
    sectionPath: 'Birth Control Pills (Oral Contraceptives)',
    text: `A small pill made of synthetic hormones. Taken daily. Regulates fertility by altering woman's hormone levels. Inhibits ovulation & prevents ovaries from releasing egg cells. When an egg cell is not present for a sperm cell to fertilize, pregnancy cannot begin.
When used correctly and consistently, 99.5% effective.`,
    startOffset: 4401,
    endOffset: 4900,
  },
  {
    id: 'seg-8',
    locator: 'Page 2',
    sectionPath: 'Condoms & Spermicides',
    text: `Latex sheath worn over the penis during intercourse. The condom catches sperm cells, so they cannot enter the vagina. Spermicidal foams are inserted into the vagina before intercourse to kill sperm in the vagina. When condoms are used correctly and with spermicidal foam, the rate of effectiveness is as high as 98%.`,
    startOffset: 4901,
    endOffset: 5400,
  },
  {
    id: 'seg-9',
    locator: 'Page 2',
    sectionPath: 'Contraceptive Patch',
    text: `The contraceptive patch is a small, thin, smooth patch that you attach directly to your skin in one of four places: the buttocks, abdomen, upper torso, or upper, outer arm. It releases a continuous, low dose of hormones similar to those found in oral contraceptives.
Patch is applied on the same day each week for three consecutive weeks. The fourth week is patch-free, during which the woman will have her menstrual period.
When used according to directions, it is 99% effective. Women over 198 lbs. may have decreased pregnancy protection.`,
    startOffset: 5401,
    endOffset: 6000,
  },
  {
    id: 'seg-10',
    locator: 'Page 2',
    sectionPath: 'Depo-Provera',
    text: `An artificial hormone given as a shot every 12 weeks. It is slowly released into the body. Depo-Provera must be prescribed.
Depo-Provera is an injection you get every three months. (If the shot is more than two weeks late, extra testing and not having sex for two weeks is necessary before the next shot.)
When taken as scheduled (4 times a year/every 12 weeks), it is more than 99% effective.
Should not be used if blood clots, liver disease, or breast cancer. No protection from STIs.`,
    startOffset: 6001,
    endOffset: 6600,
  },
  {
    id: 'seg-11',
    locator: 'Page 2',
    sectionPath: 'I.U.D.',
    text: `Small device inserted into uterus by a physician or nurse practitioner.
A string which dangles through the opening of the cervix is attached to the IUD and checked monthly. Remains there until the woman wants or needs to have it removed.
The IUD is 99% effective. There are three types of IUDs: ParaGard (copper IUD) lasts 10 years and hormone containing devices: Mirena/5 years and Kyleena/5 years.`,
    startOffset: 6601,
    endOffset: 7200,
  },
  {
    id: 'seg-12',
    locator: 'Page 2',
    sectionPath: 'Nexplanon',
    text: `A single rod is inserted in upper arm that contains Progestin. A rod is inserted and is kept in place for three years. Nexplanon is 99% effective and lasts 3 years. Continuous protection if inserted week of menses. No protection against STIs.`,
    startOffset: 7201,
    endOffset: 7600,
  },
  {
    id: 'seg-13',
    locator: 'Page 2',
    sectionPath: 'Vaginal Contraceptive Ring',
    text: `Flexible, transparent, colorless, thin vaginal ring about 2.1 inches in diameter. It releases a continuous low dose of hormones similar to those found in birth control pills. Inserted by the woman. Remains in vagina for 3 weeks. Ring removed for one week, during which she will have her menstrual period. When used according to directions, it has a 98-99% effectiveness rate.`,
    startOffset: 7601,
    endOffset: 8100,
  },
];

describe('Reviewer Document Extraction', () => {
  it('extracts concept targets for reviewer', () => {
    const targets = extractConceptTargets(REVIEWER_SEGMENTS);
    expect(new Set(targets.map((target) => target.term))).toEqual(new Set([
      'STIs and Hormonal Contraception',
      'Birth Control Pills (Oral Contraceptives)',
      'Nexplanon',
      'Vaginal Contraceptive Ring',
      'STIs and Pregnancy',
      'Condoms & Spermicides',
      'contraceptive patch',
      'I.U.D.',
      'Depo-Provera',
      'Withdrawal',
      'Contraception (or birth control)',
      'Abstinence',
      'Sterilization',
      'Can you get pregnant the first time?',
      'Fertility Awareness',
    ]));
    expect(targets).toHaveLength(15);
    expect(targets.map((target) => target.term)).not.toContain('Sterilization procedures');
    expect(targets.map((target) => target.term)).not.toContain('Spermicidal foams');
  });

  it('creates study guide for reviewer', () => {
    const guide = createStudyGuide(REVIEWER_SEGMENTS, 'reviewer');
    const terms = guide.quickReference.map((item) => item.term);
    expect(terms).toContain('Birth Control Pills (Oral Contraceptives)');
    expect(terms).toContain('Nexplanon');
    expect(terms).toContain('Sterilization');
    expect(terms).not.toContain('Sterilization procedures');
    expect(terms).not.toContain('Spermicidal foams');
    expect(terms.every((term) => term.split(/\s+/).length <= 6)).toBe(true);
  });

  it('plans efficient concept batches for reviewer', () => {
    const targets = extractConceptTargets(REVIEWER_SEGMENTS);
    const plan = planConceptBatches(targets, 16, 4);
    expect(plan.batches).toHaveLength(1);
    expect(plan.batches[0].concepts).toHaveLength(15);
  });

  it('publishes one safe automatic anchor for every reviewer target', async () => {
    const targets = extractConceptTargets(REVIEWER_SEGMENTS);
    const drafts = createTargetedExtractiveDrafts(REVIEWER_SEGMENTS, targets);
    const qualityByTarget = new Map(drafts.map((draft) => [draft.targetId, draft.qualityScore]));
    const result = await generateGroundedCardsWithFallback(
      null,
      {
        requestId: 'reviewer-local-coverage',
        sourceId: 'reviewer-source',
        sourceTitle: 'reviewer',
        maxCandidates: targets.length,
        segments: REVIEWER_SEGMENTS.map((segment) => ({
          segmentId: segment.id,
          locator: segment.locator,
          sectionPath: segment.sectionPath,
          text: segment.text,
        })),
        conceptTargets: targets,
      },
      () => drafts,
    );
    const selection = selectCandidatesForAutomaticStudy(
      result.candidates.map((candidate) => ({
        candidate,
        qualityScore: qualityByTarget.get(candidate.targetId) ?? 0,
      })),
      AUTO_PUBLISH_QUALITY_SCORE,
      targets,
    );

    const selectedTargetIds = new Set(selection.selected.map(({ candidate }) => candidate.targetId));
    const missingTargets = targets
      .filter((target) => !selectedTargetIds.has(target.id))
      .map((target) => target.term);
    expect({
      missingTargets,
      dropped: selection.dropped.map(({ candidate, reason }) => ({ targetId: candidate.targetId, reason })),
    }).toEqual({ missingTargets: [], dropped: [] });
    expect(selection.selected).toHaveLength(targets.length);
  });
});
