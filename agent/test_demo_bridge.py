import unittest
from types import SimpleNamespace as NS
from unittest.mock import Mock
from demo_bridge import collect_deals

class HistoryTests(unittest.TestCase):
 def test_only_bot_positions_and_their_manual_closures_are_uploaded(self):
  def deal(ticket,position,magic,entry):return NS(ticket=ticket,position_id=position,magic=magic,entry=entry,type=0,volume=.01,symbol='EURUSD',price=1.1,profit=2.,commission=-.1,swap=0.,fee=0.,time_msc=1800000000000+ticket,time=1800000000)
  api=Mock();api.history_deals_get.return_value=[deal(1,10,2601023,0),deal(2,10,0,1),deal(3,20,0,0)]
  rows=collect_deals(api,0)
  self.assertEqual([r['ticket'] for r in rows],['1','2']);self.assertEqual(rows[1]['entry'],'OUT');self.assertTrue(rows[1]['botPosition']);self.assertEqual(rows[1]['magic'],0)
 def test_history_failure_is_not_an_empty_success(self):
  api=Mock();api.history_deals_get.return_value=None
  with self.assertRaises(RuntimeError):collect_deals(api,0)

if __name__=='__main__':unittest.main()
